#!/usr/bin/env node
/**
 * Upload OpenCode session-manager transcripts to PCP, idempotently.
 *
 *   node import-sessions.mjs [--shared DIR]... [--opencode-db FILE] [--device-file FILE]
 *        [--base-url URL] [--token-file FILE] [--upload] [--limit N] [--json]
 *
 * Dry run is the default: it prints counts per source kind and device, total
 * messages, bytes and redaction counts, and never contacts PCP unless
 * --token-file is given (then it also reports how many sessions are new,
 * behind or up to date). --upload appends only what PCP is missing.
 *
 * Sessions are created through the scoped-token manager API with an
 * `external_key` of `<origin-device>:<kind>:<native-id>` (the session-manager
 * plugin's convention), so reruns create nothing twice. They are never made
 * public or assigned an owner: PCP keeps them admin-only by default. The token
 * needs read_all, create_sessions and mint_tokens; it is read from a file and
 * never printed.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readSharedFolder, readOpencodeDb, dedupe, externalKey, sessionTitle, sourceLabel,
  prepareMessages, batches, planUpload,
} from './lib.mjs';

function parseArgs(argv) {
  const opts = { shared: [], upload: false, json: false, limit: Infinity };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };
    if (arg === '--shared') opts.shared.push(next());
    else if (arg === '--opencode-db') opts.opencodeDb = next();
    else if (arg === '--device-file') opts.deviceFile = next();
    else if (arg === '--base-url') opts.baseUrl = next().replace(/\/+$/, '');
    else if (arg === '--token-file') opts.tokenFile = next();
    else if (arg === '--limit') opts.limit = Number(next());
    else if (arg === '--upload') opts.upload = true;
    else if (arg === '--dry-run') opts.upload = false;
    else if (arg === '--json') opts.json = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (opts.upload && (!opts.baseUrl || !opts.tokenFile)) throw new Error('--upload needs --base-url and --token-file');
  return opts;
}

function localDevice(file) {
  const candidates = [file, path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'opencode', 'device.json')].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const id = JSON.parse(fs.readFileSync(candidate, 'utf8')).id;
      if (typeof id === 'string' && id) return id;
    } catch {
      // try the next location
    }
  }
  return null;
}

async function call(opts, token, method, route, body) {
  const res = await fetch(`${opts.baseUrl}/api/v1${route}`, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { error: text.slice(0, 200) };
  }
  if (!res.ok) throw new Error(`PCP ${method} ${route.split('/').slice(0, 4).join('/')} failed (${res.status}): ${parsed?.error ?? ''}`);
  return parsed;
}

const remoteCount = async (opts, token, key) => {
  const r = await call(opts, token, 'GET', `/manager/sessions/by-key/${encodeURIComponent(key)}`);
  return r.found ? Number(r.message_count) : null;
};

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const device = localDevice(opts.deviceFile);
  const errors = [];
  const candidates = [];
  for (const dir of opts.shared) for (const s of readSharedFolder(dir, (file) => errors.push(file))) candidates.push(s);
  if (opts.opencodeDb) candidates.push(...readOpencodeDb(opts.opencodeDb, device));
  const sessions = dedupe(candidates)
    .filter((s) => s.messages.length > 0)
    .sort((a, b) => externalKey(a).localeCompare(externalKey(b)))
    .slice(0, opts.limit);

  const token = opts.tokenFile ? fs.readFileSync(opts.tokenFile, 'utf8').trim() : null;
  const summary = { revisions_read: candidates.length, unreadable_files: errors.length, sessions: 0, messages: 0, bytes: 0, by_source: {}, redactions: {}, sessions_with_redactions: 0, truncated_messages: 0, remote: {} };
  const bump = (obj, key, n = 1) => { obj[key] = (obj[key] || 0) + n; };

  for (const s of sessions) {
    const key = externalKey(s);
    const { messages, counts } = prepareMessages(s);
    const bytes = messages.reduce((n, m) => n + Buffer.byteLength(m.content), 0);
    const group = `${s.kind}@${s.originDevice}`;
    summary.by_source[group] ||= { sessions: 0, messages: 0, bytes: 0 };
    bump(summary.by_source[group], 'sessions');
    bump(summary.by_source[group], 'messages', messages.length);
    bump(summary.by_source[group], 'bytes', bytes);
    summary.sessions += 1;
    summary.messages += messages.length;
    summary.bytes += bytes;
    for (const [kind, n] of Object.entries(counts)) bump(summary.redactions, kind, n);
    if (Object.keys(counts).length) summary.sessions_with_redactions += 1;
    summary.truncated_messages += messages.filter((m) => m.content.includes('[pcp-session-import: truncated')).length;
    if (!token) continue;

    try {
      const plan = planUpload(messages.length, await remoteCount(opts, token, key));
      bump(summary.remote, plan.action);
      if (!opts.upload || !['create', 'append'].includes(plan.action)) continue;
      // Only now ask the manager for the session (it mints a session token per call).
      const remote = await call(opts, token, 'POST', '/manager/sessions', { external_key: key, title: sessionTitle(s), mode: 'wild' });
      if (!remote.access_token) throw new Error('manager did not mint a session token (needs mint_tokens)');
      for (const batch of batches(messages.slice(plan.from))) {
        const res = await fetch(`${opts.baseUrl}/api/v1/agent/sessions/${encodeURIComponent(remote.session_id)}/messages`, {
          method: 'POST',
          headers: { authorization: `Bearer ${remote.access_token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ messages: batch }),
          signal: AbortSignal.timeout(120_000),
        });
        if (!res.ok) throw new Error(`append failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
      }
      const after = await remoteCount(opts, token, key);
      if (after !== messages.length) throw new Error(`count mismatch after upload: remote ${after}, local ${messages.length}`);
      bump(summary.remote, plan.action === 'create' ? 'uploaded_new' : 'uploaded_append');
      bump(summary.remote, 'messages_uploaded', messages.length - plan.from);
    } catch (error) {
      bump(summary.remote, 'failed');
      (summary.failures ||= []).push({ key, label: sourceLabel(s), error: error instanceof Error ? error.message : String(error) });
    }
  }

  summary.megabytes = Number((summary.bytes / 1e6).toFixed(2));
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failures?.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`pcp-session-import: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
