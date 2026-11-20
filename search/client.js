const { index, model, dimension } = require('./config.json');

async function request(url, method, body, timeout = 15000) {
  const response = await fetch(url, { method, cache: 'no-store', signal: AbortSignal.timeout(timeout),
    headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) {
    // Never log upstream bodies: errors can echo queries and session text.
    const error = new Error(`search service HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}
function os(path, method = 'GET', body) {
  return request(`${process.env.PCP_SEARCH_URL}/${index}${path}`, method, body);
}
async function embed(inputs, timeout) {
  const { embeddings } = await request(`${process.env.PCP_EMBED_URL}/api/embed`, 'POST', {
    model, input: inputs, keep_alive: -1, options: { num_thread: 4 },
  }, timeout);
  if (!Array.isArray(embeddings) || embeddings.length !== inputs.length || embeddings.some(v => !Array.isArray(v) || v.length !== dimension || !v.every(Number.isFinite))) throw new Error('invalid embedding response');
  return embeddings;
}
// Lucene applies this filter to the parent session, not the nested passage.
function vectorQuery(vector, allowed, size) {
  const knn = { vector, k: size, ...(allowed ? { filter: { terms: { sid: allowed } } } : {}) };
  return { size, _source: false, query: { nested: { path: 'passages', score_mode: 'max',
    query: { knn: { 'passages.vector': knn } },
  } } };
}
module.exports = { request, os, embed, vectorQuery };
