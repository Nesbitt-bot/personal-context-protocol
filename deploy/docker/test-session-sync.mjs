#!/usr/bin/env node
/**
 * End-to-end check for external-key session sync against a running PCP.
 *
 * This exercises the contract the OpenCode session-manager plugin depends on,
 * over real HTTP against a real Postgres, because unit tests cannot prove that
 * the migration applied, the unique index holds, or the routes are reachable.
 *
 * What it asserts:
 *   1. a scoped token can create a session carrying an external_key;
 *   2. pushing the same key again returns the SAME session (created:false) —
 *      the idempotency the whole sync design rests on;
 *   3. the by-key cursor reports what the server actually stored, so a worker
 *      can resume instead of re-uploading;
 *   4. appending advances that cursor;
 *   5. an invalid external_key is rejected rather than silently accepted;
 *   6. an unknown key reports found:false rather than erroring.
 *
 * Usage (stack must already be up):
 *   node deploy/docker/test-session-sync.mjs [baseURL] [adminToken]
 */

const BASE = (process.argv[2] ?? process.env.PCP_BASE_URL ?? "http://localhost:3100").replace(/\/+$/, "")
const ADMIN = process.argv[3] ?? process.env.PCP_ADMIN_TOKEN ?? "pcp-test-admin-token-at-least-32-characters"

let passed = 0
let failed = 0

function check(name, condition, detail) {
  if (condition) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}`)
    if (detail !== undefined) console.log(`        ${typeof detail === "string" ? detail : JSON.stringify(detail)}`)
  }
}

async function api(path, { method = "GET", token, body } = {}) {
  const response = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: {
      accept: "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text }
  }
  return { status: response.status, body: json }
}

/** Wait for the app to answer and for its schema bootstrap to finish. */
async function waitForReady(timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs
  let last = "no response"
  while (Date.now() < deadline) {
    try {
      const health = await api("/health")
      last = JSON.stringify(health.body)
      if (health.status === 200) {
        // `database: pending` means the schema bootstrap has not run yet;
        // touching setup/status triggers and confirms it.
        const setup = await api("/setup/status")
        if (setup.status === 200 && setup.body?.initialized) return true
        last = `health=${JSON.stringify(health.body)} setup=${JSON.stringify(setup.body)}`
      }
    } catch (error) {
      last = error.message
    }
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }
  throw new Error(`PCP did not become ready within ${timeoutMs}ms — last: ${last}`)
}

async function main() {
  console.log(`PCP session-sync test against ${BASE}`)
  await waitForReady()

  const health = await api("/health")
  console.log(`version: ${health.body?.version}  database: ${health.body?.database}\n`)

  // A scoped token is what a sync worker actually uses.
  const minted = await api("/tokens", {
    method: "POST",
    token: ADMIN,
    body: {
      name: `session-sync-test-${Date.now()}`,
      scope: "global",
      permissions: { read_all: true, create_sessions: true, mint_tokens: true },
    },
  })
  const scoped = minted.body?.token ?? minted.body?.access_token
  check("mint a global scoped token", Boolean(scoped), minted)
  if (!scoped) {
    console.log("\ncannot continue without a scoped token")
    process.exit(1)
  }

  const externalKey = `test-device:codex:${Date.now()}`

  // 1. First push creates the session.
  const first = await api("/manager/sessions", {
    method: "POST",
    token: scoped,
    body: { external_key: externalKey, title: "session sync test", mode: "exact" },
  })
  check("create session with external_key", first.status === 200 && first.body?.success === true, first)
  check("first push reports created:true", first.body?.created === true, first.body)
  const sessionId = first.body?.session_id
  const accessToken = first.body?.access_token
  check("mints a session access token", Boolean(accessToken), first.body)

  // 2. The retry must resolve to the same session, not a duplicate.
  const second = await api("/manager/sessions", {
    method: "POST",
    token: scoped,
    body: { external_key: externalKey, title: "session sync test", mode: "exact" },
  })
  check("retry reports created:false", second.body?.created === false, second.body)
  check("retry returns the SAME session id", second.body?.session_id === sessionId, {
    first: sessionId,
    second: second.body?.session_id,
  })

  // 3. The cursor starts empty.
  const before = await api(`/manager/sessions/by-key/${encodeURIComponent(externalKey)}`, { token: scoped })
  check("by-key finds the session", before.status === 200 && before.body?.found === true, before)
  check("cursor starts at 0", before.body?.message_count === 0, before.body)
  check("by-key does not leak a topic id", before.body?.folder_id === undefined, before.body)

  // 4. Appending advances the cursor.
  const append = await api(`/agent/sessions/${sessionId}/messages`, {
    method: "POST",
    token: accessToken,
    body: {
      messages: [
        { role: "user", content: "first turn from the sync test" },
        { role: "assistant", content: "second turn from the sync test" },
      ],
    },
  })
  check("append two messages", append.status === 200, append)

  const after = await api(`/manager/sessions/by-key/${encodeURIComponent(externalKey)}`, { token: scoped })
  check("cursor advances to 2", after.body?.message_count === 2, after.body)
  check("last_ordinal matches the count", after.body?.last_ordinal === 2, after.body)

  // 5. A malformed key must be rejected, not stored.
  const bad = await api("/manager/sessions", {
    method: "POST",
    token: scoped,
    body: { external_key: "   ", title: "should not be created" },
  })
  check("empty external_key is rejected", bad.status === 400 && bad.body?.code === "VALIDATION_ERROR", bad)

  const tooLong = await api("/manager/sessions", {
    method: "POST",
    token: scoped,
    body: { external_key: "x".repeat(201), title: "should not be created" },
  })
  check("over-long external_key is rejected", tooLong.status === 400, tooLong)

  // 6. An unknown key is a normal negative answer.
  const missing = await api(`/manager/sessions/by-key/${encodeURIComponent("test-device:codex:does-not-exist")}`, {
    token: scoped,
  })
  check("unknown key reports found:false", missing.status === 200 && missing.body?.found === false, missing)

  // A session created without an external key must still work.
  const plain = await api("/manager/sessions", {
    method: "POST",
    token: scoped,
    body: { title: "no external key" },
  })
  check("session without external_key still creates", plain.status === 200 && plain.body?.success === true, plain)

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(`\nfatal: ${error.message}`)
  process.exit(1)
})
