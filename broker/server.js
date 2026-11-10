#!/usr/bin/env node
/**
 * PCP broker (design Phase 4): the only path from AstrBot to OpenClaw.
 *
 *   AstrBot plugin --(ingress credential + HMAC-signed stamp)--> broker (loopback)
 *     -> PCP  POST /api/v1/service/broker/turns            (verify, grant, policy, context)
 *     -> OpenClaw POST /v1/chat/completions   (gateway token, agent:<agent>:pcp:<grant> key)
 *     -> PCP  POST /api/v1/service/broker/turns/complete   (record reply, end grant)
 *     <- { reply }
 *
 * - Loopback only: refuses to bind anything else unless
 *   PCP_BROKER_ALLOW_NON_LOOPBACK=1. Never publish it or put it on a tunnel.
 * - Holds the OpenClaw gateway token and its own broker credential, read from
 *   files (a mounted secret dir); AstrBot never sees either. Nothing secret
 *   and no message text is logged.
 * - Fails closed: PCP unreachable or any verification failure means no reply
 *   (AstrBot's plugin stays silent). Same image as the app, no dependencies.
 */
'use strict';

const http = require('http');
const fs = require('fs');

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
const MAX_BODY_BYTES = 12 * 1024 * 1024;

function loadConfig(env = process.env) {
  const trim = (value) => String(value || '').replace(/\/+$/, '');
  return {
    host: env.PCP_BROKER_HOST || '127.0.0.1',
    port: Number(env.PCP_BROKER_PORT || 3101),
    allowNonLoopback: env.PCP_BROKER_ALLOW_NON_LOOPBACK === '1',
    pcpUrl: trim(env.PCP_BROKER_PCP_URL || 'http://127.0.0.1:3000'),
    openclawUrl: trim(env.PCP_BROKER_OPENCLAW_URL || 'http://127.0.0.1:18789'),
    credentialFile: env.PCP_BROKER_CREDENTIAL_FILE || '/run/secrets/pcp-broker/broker.token',
    gatewayTokenFile: env.PCP_BROKER_GATEWAY_TOKEN_FILE || '/run/secrets/pcp-broker/openclaw-gateway.token',
    pcpTimeoutMs: Number(env.PCP_BROKER_PCP_TIMEOUT_MS || 10000),
    openclawTimeoutMs: Number(env.PCP_BROKER_OPENCLAW_TIMEOUT_MS || 240000),
  };
}

/** Upstreams must be loopback http or https. */
function upstreamOk(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || (u.protocol === 'http:' && LOOPBACK.has(u.hostname.replace(/^\[|\]$/g, '')));
  } catch { return false; }
}

function readSecret(file) {
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; }
}

function log(level, message) {
  process.stderr.write(`${new Date().toISOString()} ${level} ${message}\n`);
}

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let exceeded = false;
    req.on('data', (chunk) => {
      if (exceeded) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { exceeded = true; chunks.length = 0; reject(Object.assign(new Error('too large'), { status: 413 })); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function postJson(fetchImpl, url, headers, body, timeoutMs) {
  const response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body, signal: AbortSignal.timeout(timeoutMs) });
  let json = null;
  try {
    if (response.body?.getReader) {
      const reader = response.body.getReader(), chunks = []; let length = 0;
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        length += value.length;
        if (length > MAX_BODY_BYTES) { await reader.cancel(); throw new Error('upstream body limit'); }
        chunks.push(value);
      }
      json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } else json = await response.json();
  } catch { json = null; }
  return { status: response.status, ok: response.ok, json };
}

function replyText(completion) {
  const content = completion?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('');
  return '';
}

function createBroker(cfg = loadConfig(), deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const secrets = deps.secrets || (() => ({ broker: readSecret(cfg.credentialFile), gateway: readSecret(cfg.gatewayTokenFile) }));

  async function turn(req, res) {
    const { broker, gateway } = secrets();
    if (!broker || !gateway) {
      log('WARN', 'AstrBot turn refused: PCP broker / configuration — broker credential or gateway token file missing; no reply.');
      return send(res, 503, { error: 'broker not configured', code: 'BROKER_NOT_CONFIGURED' });
    }
    let raw;
    try { raw = await readBody(req); } catch (error) { return send(res, error.status || 400, { error: 'unreadable body', code: 'BAD_REQUEST' }); }

    let prepared;
    try {
      prepared = await postJson(fetchImpl, `${cfg.pcpUrl}/api/v1/service/broker/turns`, {
        authorization: `Bearer ${broker}`,
        'x-pcp-ingress-authorization': String(req.headers.authorization || ''),
        'x-pcp-signature': String(req.headers['x-pcp-signature'] || ''),
      }, raw, cfg.pcpTimeoutMs);
    } catch {
      log('WARN', 'AstrBot turn refused: PCP broker / prepare — PCP unreachable; failing closed, no reply.');
      return send(res, 503, { error: 'PCP unavailable', code: 'PCP_UNAVAILABLE' });
    }
    if (!prepared.ok || !prepared.json?.turn_id) {
      const status = prepared.status === 401 || prepared.status === 403 ? 401 : prepared.status >= 500 || !prepared.json ? 503 : prepared.status;
      log('WARN', `AstrBot turn refused: PCP broker / prepare — PCP answered ${prepared.status} ${String(prepared.json?.code || '').slice(0, 40)}; no reply.`);
      return send(res, status, { error: 'turn refused', code: String(prepared.json?.code || 'REFUSED').slice(0, 40) });
    }
    const t = prepared.json;
    // OpenClaw runs the agent named in the key; refuse anything inconsistent.
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(String(t.agent)) || t.session_key !== `agent:${t.agent}:pcp:${t.turn_id}` || t.model !== `openclaw/${t.agent}`) {
      log('WARN', 'AstrBot turn refused: PCP broker / prepare — inconsistent agent, model or session key from PCP; no reply.');
      return send(res, 503, { error: 'turn refused', code: 'INCONSISTENT_TURN' });
    }
    const complete = (body) => postJson(fetchImpl, `${cfg.pcpUrl}/api/v1/service/broker/turns/complete`, { authorization: `Bearer ${broker}` }, JSON.stringify({ turn_id: t.turn_id, ...body }), cfg.pcpTimeoutMs)
      .catch(() => ({ ok: false, status: 0 }));

    let completion;
    try {
      completion = await postJson(fetchImpl, `${cfg.openclawUrl}/v1/chat/completions`, {
        authorization: `Bearer ${gateway}`,
        'x-openclaw-session-key': t.session_key,
        'x-openclaw-agent-id': t.agent,
        'x-openclaw-media': 'inline',
      }, JSON.stringify({ model: t.model, messages: t.messages, stream: false }), cfg.openclawTimeoutMs);
    } catch {
      completion = { ok: false, status: 0, json: null };
    }
    const reply = completion.ok ? replyText(completion.json).trim() : '';
    const media = completion.ok && Array.isArray(completion.json?.choices?.[0]?.message?.attachments) ? completion.json.choices[0].message.attachments : [];
    if (!reply && !media.length) {
      await complete({ status: 'error', error_code: completion.ok ? 'EMPTY_REPLY' : `OPENCLAW_${completion.status || 'UNREACHABLE'}` });
      log('WARN', `AstrBot turn failed: PCP broker / OpenClaw — ${completion.ok ? 'empty reply' : `HTTP ${completion.status || 'unreachable'}`} for ${t.turn_id} (${t.agent}).`);
      return send(res, 502, { error: 'OpenClaw did not reply', code: 'OPENCLAW_ERROR' });
    }
    const recorded = await complete({ status: 'ok', reply, ...(media.length ? { media } : {}) });
    if (media.length && (!recorded.ok || !recorded.json?.media?.length)) {
      log('WARN', `Attachment delivery refused: PCP broker/recording — media could not be saved for ${t.turn_id}.`);
      return send(res, 502, { error: 'Attachment not sent: PCP broker/recording — media storage failed', code: 'MEDIA_RECORDING_FAILED' });
    }
    if (!recorded.ok) log('WARN', `AstrBot turn not recorded: PCP broker / complete — PCP answered ${recorded.status}; reply still returned for ${t.turn_id}.`);
    log('INFO', `AstrBot turn done: PCP broker — ${t.turn_id} via ${t.agent}.`);
    return send(res, 200, { reply, turn_id: t.turn_id, agent: t.agent, ...(media.length ? { media: recorded.json.media } : {}) });
  }

  return http.createServer((req, res) => {
    const path = (req.url || '').split('?')[0];
    if (req.method === 'GET' && path === '/healthz') {
      const { broker, gateway } = secrets();
      return send(res, 200, { status: 'ok', configured: Boolean(broker && gateway) });
    }
    if (req.method === 'POST' && path === '/v1/delivery') {
      readBody(req).then(raw => postJson(fetchImpl, `${cfg.pcpUrl}/api/v1/service/broker/delivery`, {
        authorization: String(req.headers.authorization || ''), 'x-pcp-signature': String(req.headers['x-pcp-signature'] || ''),
      }, raw, cfg.pcpTimeoutMs)).then(result => send(res, result.status, result.json || { code: 'INVALID_REPLY' }))
        .catch(() => send(res, 503, { code: 'PCP_UNAVAILABLE' }));
      return undefined;
    }
    if (req.method === 'POST' && path === '/v1/turn') {
      turn(req, res).catch(() => send(res, 500, { error: 'internal error', code: 'INTERNAL_ERROR' }));
      return undefined;
    }
    return send(res, 404, { error: 'not found', code: 'NOT_FOUND' });
  });
}

function main() {
  const cfg = loadConfig();
  if (!LOOPBACK.has(cfg.host) && !cfg.allowNonLoopback) {
    log('ERROR', `PCP broker not started: broker / bind — ${cfg.host} is not loopback; the broker must never be reachable from other machines.`);
    process.exit(1);
  }
  if (!upstreamOk(cfg.pcpUrl) || !upstreamOk(cfg.openclawUrl)) {
    log('ERROR', 'PCP broker not started: broker / configuration — upstream URLs must be loopback http or https.');
    process.exit(1);
  }
  const server = createBroker(cfg);
  server.listen(cfg.port, cfg.host, () => log('INFO', `PCP broker listening on ${cfg.host}:${cfg.port} (loopback only).`));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

module.exports = { createBroker, loadConfig, upstreamOk, replyText };
if (require.main === module) main();
