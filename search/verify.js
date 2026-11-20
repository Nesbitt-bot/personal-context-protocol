// Read-only operator smoke check: compare the entire indexed ID set and exercise
// the production vector query with an allowed session and with a nonexistent ID.
const assert = require('node:assert/strict');
const postgres = require('postgres');
const { os, embed, vectorQuery } = require('./client');
async function verify() {
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    const expected = new Set((await sql`select id from sessions`).map(row => row.id));
    let cursor, indexed = 0, ready = 0, example;
    for (;;) {
      const {hits} = await os('/_search','POST',{size:256,sort:['sid'],_source:['ready'],search_after:cursor});
      if (!hits.hits.length) break;
      for (const h of hits.hits) {
        assert(expected.delete(h._id), 'unexpected indexed session'); indexed++;
        if (h._source.ready) { example = h._id; ready++; }
      }
      cursor = hits.hits.at(-1).sort;
    }
    console.info({indexed, ready, missing:expected.size});
    assert(!expected.size && ready === indexed, 'index is still converging');
    if (!example) return;
    const [vector] = await embed(['task: search result | query: retrieve a recorded conversation'], 60000);
    for (const [allowed, count] of [[[example], 1], [['nonexistent-verification-session'], 0]]) {
      const {hits} = await os('/_search','POST',vectorQuery(vector, allowed, 10));
      assert.equal(hits.hits.length, count); assert(hits.hits.every(h => allowed.includes(h._id)));
    }
    console.info('Scoped semantic retrieval verified');
  } finally { await sql.end(); }
}
verify().catch(e => { console.error('Search verification failed:', e.message); process.exitCode = 1; });
