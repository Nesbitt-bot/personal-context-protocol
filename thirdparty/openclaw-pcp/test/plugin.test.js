import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compilePatterns, DEFAULT_HTTP_SESSION_PATTERNS, isHttpSessionKey, resolveTarget } from "../lib/session.js";
import { redactSecrets } from "../lib/redact.js";
import { batches, buildContextBlock, extractTurn } from "../lib/turns.js";
import { DiskQueue } from "../lib/queue.js";
import { createPlugin } from "../index.js";
import { OWNER_LINKS, fakeApi, ownerCtx, setup } from "./helpers.js";

const prefixes = ["telegram:", "openclaw-weixin:"];
const target = (sessionKey, channel, senderId) => resolveTarget({ sessionKey, channel, senderId, identityLinks: OWNER_LINKS, allowedPrefixes: prefixes });

// ---------------------------------------------------------------- session.js
test("owner session resolves the linked principal of the runtime channel only", () => {
  assert.equal(target("agent:main:direct:owner", "telegram").principal, "telegram:100000001");
  assert.equal(target("agent:main:direct:owner", "openclaw-weixin").principal, "openclaw-weixin:wxid-test@im.wechat");
  assert.equal(target("agent:main:direct:owner", undefined), null, "two links and no channel is ambiguous");
  assert.equal(target("agent:main:direct:owner", "discord"), null);
});

test("unlinked peers, per-channel keys, groups, HTTP and unknown keys", () => {
  assert.deepEqual(target("agent:main:direct:12345", "telegram"), { principal: "telegram:12345", chat: "direct", channel: "telegram", peer: "12345" });
  assert.equal(target("agent:main:direct:12345", undefined), null);
  assert.equal(target("agent:main:telegram:direct:777", undefined).principal, "telegram:777");
  assert.equal(target("agent:main:telegram:acct:direct:777", "telegram").principal, "telegram:777");
  assert.equal(target("agent:main:telegram:direct:777", "openclaw-weixin"), null, "key channel and runtime channel disagree");
  assert.equal(target("agent:main:discord:direct:777", undefined), null, "platform not allowed for this credential");
  assert.equal(target("agent:main:telegram:group:-100", "telegram"), null, "group needs a trusted sender");
  assert.deepEqual(target("agent:main:telegram:group:-100", "telegram", "42"), { principal: "telegram:42", chat: "group", groupId: "-100", channel: "telegram", peer: "42" });
  for (const key of ["agent:relay:openai:5b0c", "agent:dashboard-host:openai-user:dashboard-1", "agent:main:main", "pcp:grt_1", "cron:abc", undefined]) {
    assert.equal(target(key, "telegram"), null, String(key));
  }
  assert.equal(target("agent:main:direct:evil:group:1", "telegram"), null);
});

test("HTTP session key detection", () => {
  const patterns = compilePatterns(DEFAULT_HTTP_SESSION_PATTERNS);
  assert.ok(isHttpSessionKey("agent:relay:openai:0c9d", patterns));
  assert.ok(isHttpSessionKey("agent:dashboard-host:openai-user:dashboard-abc", patterns));
  assert.ok(!isHttpSessionKey("agent:main:direct:owner", patterns));
  assert.ok(!isHttpSessionKey("agent:main:openaiish", patterns));
  assert.ok(!isHttpSessionKey(undefined, patterns));
});

// ----------------------------------------------------------------- redact.js
test("redaction replaces secret values, counts kinds and is idempotent", () => {
  const input = [
    "token=abcdef1234567890", "Authorization: Bearer eyJhbGciOi.abcdefgh", "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "sk-ant-api03-abcdefghijklmnopqrstuvwxyz", "postgres://pcp:hunter2secret@db:5432/pcp", "Cookie: sid=abc; csrf=def",
    "pcps_0123456789abcdef0123456789abcdef", "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----",
    "AKIAABCDEFGHIJKLMNOP", "123456789:AAabcdefghijklmnopqrstuvwxyz0123456", "plain words stay",
  ].join("\n");
  const { text, redactions } = redactSecrets(input);
  for (const secret of ["abcdef1234567890", "eyJhbGciOi.abcdefgh", "ghp_abc", "sk-ant-api03", "hunter2secret", "sid=abc", "pcps_0123", "AAAA", "AKIAABCD", ":AAabcdef"]) {
    assert.ok(!text.includes(secret), `leaked ${secret}`);
  }
  assert.ok(text.includes("plain words stay"));
  assert.ok(redactions.length >= 10);
  assert.deepEqual(redactSecrets(text).redactions, [], "second pass finds nothing new");
});

// ------------------------------------------------------------------ turns.js
test("extractTurn takes the last user message onward, strips injected context, skips tools", () => {
  const messages = [
    { role: "user", content: "old", timestamp: 1 },
    { role: "assistant", content: [{ type: "text", text: "old reply" }], timestamp: 2 },
    { role: "user", content: [{ type: "text", text: "<pcp_context>\nsecret cross-session\n</pcp_context>\n\nwhat is up" }], timestamp: 1730800000000 },
    { role: "assistant", content: [{ type: "toolCall", id: "t", name: "exec" }], timestamp: 4 },
    { role: "toolResult", content: [{ type: "text", text: "tool output" }], timestamp: 5 },
    { role: "assistant", content: [{ type: "text", text: "all good" }], provider: "cpa", model: "m1", timestamp: 6 },
  ];
  const turn = extractTurn(messages);
  assert.equal(turn.anchorId, "1730800000000");
  assert.deepEqual(turn.messages.map((m) => [m.role, m.content]), [["user", "what is up"], ["assistant", "all good"]]);
  assert.equal(turn.messages[1].base_model, "m1");
  assert.equal(extractTurn([{ role: "assistant", content: "x" }]), null);
});

test("context block excludes the home session and stays bounded", () => {
  const recall = {
    sessions: [{ id: "home", title: "Home" }, { id: "other", title: "WeChat" }],
    messages: [
      { session_id: "home", role: "user", content: "home only" },
      ...Array.from({ length: 20 }, (_, i) => ({ session_id: "other", role: "user", content: `msg ${i} ${"x".repeat(500)}` })),
      { session_id: "other", role: "tool", content: "[pcp audit] skip me" },
    ],
  };
  const block = buildContextBlock(recall, "home");
  assert.ok(block.startsWith("<pcp_context>") && block.endsWith("</pcp_context>"));
  assert.ok(!block.includes("home only") && !block.includes("pcp audit"));
  assert.ok(block.length < 2000);
  assert.equal(buildContextBlock({ sessions: [], messages: [{ session_id: "home", role: "user", content: "x" }] }, "home"), null);
  assert.deepEqual(batches("k", Array.from({ length: 120 }, () => ({}))).map((b) => [b.key, b.messages.length]), [["k", 50], ["k#1", 50], ["k#2", 20]]);
});

// ------------------------------------------------------------------ queue.js
test("disk queue: dedupe, bound, backoff, permanent drop, atomic persistence with mode 600", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcp-queue-"));
  const file = path.join(dir, "q", "queue.json");
  let clock = 1000;
  const warnings = [];
  const q = new DiskQueue({ file, maxItems: 3, maxAttempts: 2, now: () => clock, logger: { warn: (m) => warnings.push(m) } });
  assert.equal(q.push({ kind: "turn", key: "a" }), true);
  assert.equal(q.push({ kind: "turn", key: "a" }), false);
  q.push({ kind: "turn", key: "b" }); q.push({ kind: "turn", key: "c" }); q.push({ kind: "turn", key: "d" });
  assert.deepEqual(q.items.map((i) => i.key), ["b", "c", "d"]);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  q.fail("b");
  assert.deepEqual(q.due().map((i) => i.key), ["c", "d"]);
  clock += 5000;
  assert.deepEqual(q.due().map((i) => i.key), ["b", "c", "d"]);
  q.fail("b");
  q.fail("c", { permanent: true });
  assert.deepEqual(q.items.map((i) => i.key), ["d"]);
  const reloaded = new DiskQueue({ file, now: () => clock });
  assert.deepEqual(reloaded.items.map((i) => i.key), ["d"]);
  fs.writeFileSync(file, "{not json");
  assert.equal(new DiskQueue({ file, now: () => clock, logger: { warn: (m) => warnings.push(m) } }).size, 0);
  assert.ok(warnings.some((w) => w.includes("discarded")) && warnings.some((w) => w.includes("unreadable")));
  fs.rmSync(dir, { recursive: true });
});

// ------------------------------------------------------------- plugin hooks
test("before_prompt_build injects bounded cross-channel context for a linked owner", async () => {
  const { pcp, hook } = setup({ linked: true });
  const result = await hook("before_prompt_build")({ prompt: "hi", messages: [{ role: "user", content: "earlier" }] }, ownerCtx("telegram"));
  assert.match(result.prependContext, /dentist/);
  assert.doesNotMatch(result.prependContext, /telegram home message/);
  const grant = pcp.calls.find((c) => c.pathname.endsWith("/grants"));
  assert.equal(grant.body.principal, "telegram:100000001");
  assert.equal(grant.body.session_key, "agent:main:direct:owner");
  assert.equal(grant.body.issue_claim, undefined, "not a new session");
});

test("unlinked principal gets a grant but no injected context", async () => {
  const { pcp, hook } = setup();
  const result = await hook("before_prompt_build")({ prompt: "hi", messages: [{ role: "user", content: "earlier" }] }, ownerCtx("telegram"));
  assert.equal(result, undefined);
  assert.equal(pcp.calls.filter((c) => c.pathname.endsWith("/recall")).length, 0);
});

test("PCP down or slow: the run continues without context inside the time budget", async () => {
  const { pcp, hook, warnings } = setup({ linked: true, pluginConfig: { contextTimeoutMs: 200 } });
  pcp.down = true;
  assert.equal(await hook("before_prompt_build")({ prompt: "hi", messages: [] }, ownerCtx()), undefined);
  pcp.down = false;
  pcp.delayMs = 1500;
  const started = Date.now();
  assert.equal(await hook("before_prompt_build")({ prompt: "hi", messages: [{ role: "user", content: "x" }] }, { ...ownerCtx(), sessionKey: "agent:main:direct:999" }), undefined);
  assert.ok(Date.now() - started < 1000, "bounded by contextTimeoutMs");
  assert.ok(warnings.some((w) => /Continuing without PCP context/.test(w)));
});

test("non-user triggers, HTTP runs and unattributed sessions never call PCP", async () => {
  const { pcp, hook } = setup({ linked: true });
  await hook("before_prompt_build")({ prompt: "x", messages: [] }, { ...ownerCtx(), trigger: "heartbeat" });
  await hook("before_prompt_build")({ prompt: "x", messages: [] }, { agentId: "relay", sessionKey: "agent:relay:openai:1", channelId: "webchat", trigger: "user" });
  await hook("before_prompt_build")({ prompt: "x", messages: [] }, { agentId: "main", sessionKey: "agent:main:main", channelId: "telegram", trigger: "user" });
  await hook("before_prompt_build")({ prompt: "x", messages: [] }, { agentId: "main", sessionKey: "agent:main:telegram:group:-100", channelId: "telegram", trigger: "user" });
  assert.equal(pcp.calls.length, 0);
});

test("HTTP backstop refuses every tool except pcp_* and works without PCP credentials", async () => {
  for (const token of ["pcps_test", ""]) {
    const { hook, hooks } = setup({ token });
    const before = hook("before_tool_call");
    assert.equal(hooks.get("before_tool_call").opts.priority, 1000);
    for (const key of ["agent:relay:openai:0c9d", "agent:dashboard-host:openai-user:dashboard-1"]) {
      for (const tool of ["exec", "read", "web_fetch", "session_status", "dashboard_stream"]) {
        const result = before({ toolName: tool, params: {} }, { sessionKey: key, toolName: tool });
        assert.equal(result.block, true, `${key} ${tool}`);
        assert.match(result.blockReason, /HTTP API runs/);
      }
      assert.equal(before({ toolName: "pcp_search", params: {} }, { sessionKey: key, toolName: "pcp_search" }), undefined);
    }
    assert.equal(before({ toolName: "exec", params: {} }, { sessionKey: "agent:main:direct:owner", toolName: "exec" }), undefined);
  }
});

test("pcp_* tools use the service credential and ctx.sessionKey only", async () => {
  const { pcp, tools } = setup({ linked: true });
  assert.deepEqual(tools[0].opts, { optional: true, names: ["pcp_context", "pcp_search"] });
  const list = tools[0].factory({ agentId: "main", sessionKey: "agent:main:direct:owner", messageChannel: "telegram", requesterSenderId: "100000001" });
  const search = list.find((t) => t.name === "pcp_search");
  assert.equal(search.parameters.additionalProperties, false);
  assert.deepEqual(Object.keys(search.parameters.properties).sort(), ["limit", "query"]);
  const result = await search.execute("call-1", { query: "dentist", session_key: "agent:other:direct:victim", principal: "telegram:1" });
  assert.match(result.content[0].text, /dentist/);
  assert.equal(result.details.count, 1);
  for (const call of pcp.calls) {
    assert.equal(call.body.session_key, "agent:main:direct:owner");
    assert.equal(call.auth, "Bearer pcps_test");
    if (call.body.principal) assert.equal(call.body.principal, "telegram:100000001");
  }
  const context = await list.find((t) => t.name === "pcp_context").execute("call-2", {});
  assert.match(context.content[0].text, /WeChat/);
  const http = tools[0].factory({ agentId: "relay", sessionKey: "agent:relay:openai:1", messageChannel: "webchat" });
  assert.match((await http[1].execute("c", { query: "dentist" })).content[0].text, /not available/);
  assert.equal(tools[0].factory({}), null);
});

test("agent_end syncs the redacted turn once, idempotent by external key", async () => {
  const { pcp, hook, plugin, queue } = setup();
  const messages = [
    { role: "user", content: "<pcp_context>\nx\n</pcp_context>\n\nmy password=supersecret99 please", timestamp: 1730800000000 },
    { role: "assistant", content: [{ type: "text", text: "noted" }], timestamp: 1730800001000 },
  ];
  hook("agent_end")({ messages, success: true }, ownerCtx("openclaw-weixin"));
  await plugin.flush();
  hook("agent_end")({ messages, success: true }, ownerCtx("openclaw-weixin"));
  await plugin.flush();
  assert.equal(pcp.synced.size, 1);
  const [[key, stored]] = [...pcp.synced];
  assert.equal(key, "oc:sid-1:1730800000000");
  assert.equal(stored.home, "ses_home_wx");
  assert.equal(stored.messages[0].content, "my password=<REDACTED> please");
  assert.equal(stored.messages[0].provider_timestamp, new Date(1730800000000).toISOString());
  assert.equal(queue.size, 0);
  assert.ok(plugin.stats.redactions >= 1);
  hook("agent_end")({ messages, success: true }, { ...ownerCtx(), trigger: "cron" });
  hook("agent_end")({ messages, success: true }, { agentId: "relay", sessionKey: "agent:relay:openai:1", sessionId: "s", channelId: "webchat" });
  await plugin.flush();
  assert.equal(pcp.synced.size, 1);
});

test("sync survives a PCP outage through the retry queue", async () => {
  const { pcp, hook, plugin, queue } = setup();
  pcp.down = true;
  hook("agent_end")({ messages: [{ role: "user", content: "hello", timestamp: 5 }, { role: "assistant", content: "hi", timestamp: 6 }] }, ownerCtx());
  await plugin.flush();
  assert.equal(queue.size, 1);
  assert.equal(pcp.synced.size, 0);
  pcp.down = false;
  queue.items[0].nextAt = 0;
  await plugin.flush();
  assert.equal(queue.size, 0);
  assert.equal(pcp.synced.size, 1);
});

test("claim link: appended once to the first reply of a new unlinked Telegram DM, never shown to the model", async () => {
  const { pcp, hook } = setup();
  const result = await hook("before_prompt_build")({ prompt: "hello", messages: [] }, ownerCtx("telegram"));
  assert.equal(result, undefined, "nothing injected, so the model never sees the code");
  assert.equal(pcp.calls[0].body.issue_claim, true);
  const send = hook("message_sending");
  assert.equal(send({ to: "999", content: "x" }, { channelId: "telegram" }), undefined, "other chats unaffected");
  const first = send({ to: "100000001", content: "Hi there" }, { channelId: "telegram", conversationId: "100000001" });
  assert.match(first.content, /^Hi there\n\nLink this chat to your PCP account .*https:\/\/pcp\.example\.test\/claim\?code=CODE123$/s);
  assert.equal(send({ to: "100000001", content: "second" }, { channelId: "telegram" }), undefined, "single use");
});

test("claim link skipped for linked owners, ongoing sessions, Weixin and groups", async () => {
  const linked = setup({ linked: true });
  await linked.hook("before_prompt_build")({ prompt: "hi", messages: [] }, ownerCtx("telegram"));
  assert.equal(linked.hook("message_sending")({ to: "100000001", content: "x" }, { channelId: "telegram" }), undefined);

  const { pcp, hook } = setup();
  await hook("before_prompt_build")({ prompt: "hi", messages: [{ role: "assistant", content: "earlier" }] }, ownerCtx("telegram"));
  await hook("before_prompt_build")({ prompt: "hi", messages: [] }, ownerCtx("openclaw-weixin"));
  await hook("before_prompt_build")({ prompt: "hi", messages: [] }, { ...ownerCtx(), sessionKey: "agent:main:telegram:group:-100" });
  assert.ok(pcp.calls.every((c) => c.body.issue_claim === undefined));
  assert.equal(hook("message_sending")({ to: "100000001", content: "x" }, { channelId: "telegram" }), undefined);
});

test("after_tool_call audits PCP accesses; after_compaction uploads the summary", async () => {
  const { pcp, hook, plugin } = setup({ linked: true });
  await hook("before_prompt_build")({ prompt: "hi", messages: [{ role: "user", content: "x" }] }, ownerCtx("telegram"));
  hook("after_tool_call")({ toolName: "pcp_search", params: { query: "api_key=abcdef123456" }, toolCallId: "tc1", result: { details: { count: 2 } }, durationMs: 12 }, { sessionKey: "agent:main:direct:owner", sessionId: "sid-1", toolName: "pcp_search" });
  hook("after_tool_call")({ toolName: "exec", params: {} }, { sessionKey: "agent:main:direct:owner", sessionId: "sid-1", toolName: "exec" });
  await plugin.flush();
  const audit = pcp.synced.get("oc-audit:sid-1:tc1");
  assert.equal(audit.messages[0].role, "tool");
  assert.equal(audit.messages[0].content, '[pcp audit] pcp_search query="api_key=<REDACTED>" -> 2 item(s), 12 ms');
  assert.equal(pcp.synced.size, 1);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcp-compact-"));
  const file = path.join(dir, "s.jsonl");
  fs.writeFileSync(file, [JSON.stringify({ type: "message", id: "m1" }), JSON.stringify({ type: "compaction", id: "c9", summary: "We decided X. token=abcdef123456" }), ""].join("\n"));
  hook("after_compaction")({ messageCount: 10, compactedCount: 8, sessionFile: file }, ownerCtx("telegram"));
  for (let i = 0; i < 50 && !pcp.synced.has("oc-compaction:sid-1:c9"); i += 1) { await new Promise((r) => setTimeout(r, 10)); await plugin.flush(); }
  const compaction = pcp.synced.get("oc-compaction:sid-1:c9");
  assert.equal(compaction.messages[0].role, "system");
  assert.equal(compaction.messages[0].content, "[OpenClaw compaction summary]\nWe decided X. token=<REDACTED>");
  fs.rmSync(dir, { recursive: true });
});

test("configuration: non-loopback http base URL is rejected; missing token disables PCP features only", () => {
  const { api } = fakeApi({ baseUrl: "http://pcp.example.test" });
  assert.throws(() => createPlugin(api, { token: "pcps_test", startTimer: false, queue: new DiskQueue({ file: null }) }), /https or loopback/);
  const off = fakeApi();
  const plugin = createPlugin(off.api, { token: "", startTimer: false });
  assert.equal(plugin.enabled, false);
  assert.ok(off.hooks.has("before_tool_call"));
  assert.ok(!off.hooks.has("before_prompt_build"));
  assert.equal(off.tools.length, 0);
});
