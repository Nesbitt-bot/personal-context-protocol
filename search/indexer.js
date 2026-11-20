const postgres = require('postgres');
const { createHash } = require('node:crypto');
const { setTimeout: sleep } = require('node:timers/promises');
const { request, os, embed } = require('./client');
const { model, digest, dimension } = require('./config.json');
const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 10, connection: { default_transaction_read_only: 'on' } });
const mapping = { settings: { number_of_shards: 1, number_of_replicas: 0, 'index.knn': true }, mappings: {
  dynamic: 'strict', properties: {
    sid: { type: 'keyword' }, title: { type: 'text' }, summary: { type: 'text' }, fingerprint: { type: 'keyword' }, ready: { type: 'boolean' },
    messages: { properties: { ordinal: { type: 'integer' }, role: { type: 'keyword' }, content: { type: 'text' } } },
    passages: { type: 'nested', properties: { vector: { type: 'knn_vector', dimension,
      method: { name: 'hnsw', engine: 'lucene', space_type: 'cosinesimil' } } } },
  },
} };

async function reconcile() {
  // Page by immutable id. The durable fingerprint includes message edits/deletes,
  // not just the last ordinal. Do not index tokens, raw import payloads or attachments.
  let after = '', changes = 0;
  for (;;) {
    const rows = await sql`select s.id as sid, s.title, concat_ws(' ',s.context_title,s.context_summary,(select string_agg(c.summary,' ' order by c.created_at,c.id) from compactions c where c.session_id=s.id)) as summary,
      coalesce((select json_agg(json_build_object('ordinal',m.ordinal,'role',m.role,'content',m.content) order by m.ordinal)
      from messages m where m.session_id=s.id),'[]') as messages from sessions s where s.id > ${after} order by s.id limit 16`;
    if (!rows.length) break;
    const {docs} = await os('/_mget?_source_includes=fingerprint', 'POST', { ids: rows.map(r => r.sid) });
    for (const [i, row] of rows.entries()) {
      const fingerprint = createHash('sha256').update(JSON.stringify(row)).digest('hex');
      if (docs[i]._source?.fingerprint !== fingerprint) {
        await os(`/_doc/${encodeURIComponent(row.sid)}`, 'PUT', { ...row, fingerprint, ready: false });
        changes++;
      }
    }
    after = rows.at(-1).sid;
  }
  // Remove documents absent from the source of truth, even after worker downtime.
  let cursor;
  for (;;) {
    const {hits} = await os('/_search','POST',{ size: 256, _source: false, sort: ['sid'], search_after: cursor });
    if (!hits.hits.length) break;
    const ids = hits.hits.map(hit => hit._id);
    const live = new Set((await sql`select id from sessions where id in ${sql(ids)}`).map(r => r.id));
    for (const id of ids) if (!live.has(id)) { await os(`/_doc/${encodeURIComponent(id)}`, 'DELETE'); changes++; }
    cursor = hits.hits.at(-1).sort;
  }
  if (changes) console.info(new Date().toISOString(), 'INFO reconciled session documents:', changes);
}

function passages(doc) {
  const text = [doc.summary, ...doc.messages.map(m => m.content)].filter(Boolean).join('\n');
  // Limit by Unicode code points; include the tail even for very long sessions.
  const chars = Array.from(text);
  const result = [];
  for (let i = 0; i < Math.max(1, chars.length); i += 1600) {
    result.push(`title: ${doc.title.slice(0,200)} | text: ${chars.slice(i,i+1680).join('') || doc.title}`);
  }
  return result;
}
async function ensureModel() {
  const url = process.env.PCP_EMBED_URL;
  let {models} = await request(`${url}/api/tags`, 'GET');
  if (!models.some(m => m.name === model)) {
    console.info(new Date().toISOString(), 'INFO downloading retrieval model');
    await request(`${url}/api/pull`, 'POST', {model, stream:false}, 600000);
    ({models} = await request(`${url}/api/tags`, 'GET'));
  }
  if (!models.some(m => m.name === model && m.digest === digest)) throw new Error('embedding model digest mismatch');
}
const deferred = new Map();
async function enrich() {
  await ensureModel();
  for (const [id, until] of deferred) if (until <= Date.now()) deferred.delete(id);
  const {hits} = await os('/_search','POST',{ size: 1, sort: ['sid'], seq_no_primary_term:true, query:{bool:{filter:{term:{ready:false}}, must_not: deferred.size ? [{ids:{values:[...deferred.keys()]}}] : []}} });
  if (!hits.hits.length) return 5000;
  const hit = hits.hits[0], chunks = passages(hit._source), vectors = [];
  // A failed or concurrently modified document must not block the rest of the queue.
  deferred.set(hit._id, Date.now() + 300000);
  for (let i=0; i<chunks.length; i+=4) {
    const batch = await embed(chunks.slice(i,i+4), 180000);
    vectors.push(...batch.map(vector => ({vector})));
    if (i % 40 === 0 && chunks.length > 40) console.info(new Date().toISOString(), 'INFO embedding passage batch:', i, '/', chunks.length);
  }
  // Never resurrect a deleted session or attach old vectors after an edit.
  await os(`/_update/${encodeURIComponent(hit._id)}?if_seq_no=${hit._seq_no}&if_primary_term=${hit._primary_term}&refresh=wait_for`, 'POST', {doc:{ready:true, passages:vectors}});
  deferred.delete(hit._id);
  return 0;
}
async function loop(name, fn, delay) {
  for (;;) {
    try { await sleep((await fn()) ?? delay); }
    catch (err) { console.error(new Date().toISOString(), 'ERROR', name, err.status ?? err.name); await sleep(15000); }
  }
}
async function main() {
  try { await os(''); } catch (e) { if (e.status !== 404) throw e; await os('', 'PUT', mapping); }
  await Promise.all([loop('reconcile',reconcile,60000),loop('embed',enrich,1000)]);
}
if (require.main === module) main().catch(e => { console.error('Index initialization failed:',e.status ?? e.name); process.exit(1); });
module.exports = { passages };
