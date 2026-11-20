#!/usr/bin/env node
/**
 * SessionStart hook. Checks PCP connectivity and the remote status for this
 * session. Claude Code SessionStart hooks cannot hard-block a session, so when
 * a previously-synced session is resumed while PCP is unreachable this hook
 * warns the user (systemMessage) and injects context telling Claude not to
 * resume the old conversation. New sessions (never synced) are always allowed.
 *
 * Reads the Claude Code hook payload from stdin (JSON). Outputs a Claude Code
 * hook result on stdout, then exits 0.
 */

import { readConfig, readState, writeState, fetchRemote, sessionKey } from '../lib/pcp.mjs';

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
    });
    process.stdin.on('error', () => resolve({}));
  });
}

/** Write a hook result and exit 0 once stdout has flushed. */
function emit(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`, () => process.exit(0));
}

function allow(additionalContext) {
  if (additionalContext) {
    return { continue: true, hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } };
  }
  return { continue: true };
}

function warn(systemMessage, additionalContext) {
  return { continue: true, systemMessage, hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } };
}

async function main() {
  const payload = await readStdin();

  // The session id is surfaced in a few possible places depending on the hook
  // version; take the first that is present.
  const sessionId = payload.session_id || process.env.CLAUDE_SESSION_ID || payload.cwd?.replace(/[^a-zA-Z0-9]/g, '-');
  if (!sessionId) {
    // Nothing to key on. SessionStart cannot block anyway, so just continue.
    return emit(allow());
  }

  const config = readConfig();
  const key = sessionKey(config, sessionId);
  const state = readState();
  const previouslySynced = Boolean(state[sessionId]);

  const remote = await fetchRemote(config, key);

  if (remote.unreachable) {
    if (previouslySynced) {
      return emit(warn(
        'PCP is unreachable and this session was previously synced. Resuming could conflict with the remote copy — reconnect to PCP or start a new session.',
        'PCP is unreachable and this session was previously synced. Do NOT resume the previous conversation; ask the user to reconnect to PCP or start a new session instead.'
      ));
    }
    return emit(allow('PCP is unreachable, but this session has not been synced yet, so resuming is safe.'));
  }

  if (remote.found) {
    // Record the sync marker so a future offline resume is guarded.
    state[sessionId] = { key, at: new Date().toISOString(), message_count: remote.message_count, last_updated: remote.last_updated };
    writeState(state);
    return emit(allow(remote.message_count != null
      ? `Remote has ${remote.message_count} message(s); last updated ${remote.last_updated ?? 'unknown'}.`
      : 'Remote session found.'));
  }

  return emit(allow());
}

await main();
