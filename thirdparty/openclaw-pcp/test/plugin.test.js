import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyOwnerBinding, checkOwnerPrincipals, compilePatterns, DEFAULT_HTTP_SESSION_PATTERNS, isBrokerSessionKey, isHttpSessionKey, resolveTarget } from "../lib/session.js";
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
  assert.deepEqual(tools[0].opts, { optional: true, names: ["pcp_context", "pcp_search", "pcp_attachment"] });
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

// ------------------------------------------------------- PCP broker (Phase 4)
const BROKER_KEY = `pcp:grt_${"ab".repeat(24)}`;

test("broker session keys: detected in both shapes, never a trusted target, always an HTTP run", () => {
  for (const key of [BROKER_KEY, `agent:relay-owner:${BROKER_KEY}`, BROKER_KEY.toUpperCase().replace("PCP:GRT_", "pcp:grt_")]) {
    assert.equal(isBrokerSessionKey(key), true, key);
    assert.equal(target(key, "webchat"), null);
    assert.equal(isHttpSessionKey(key, compilePatterns(DEFAULT_HTTP_SESSION_PATTERNS)), true);
  }
  for (const key of ["pcp:grt_123", "pcp:grt_1793904467977_c4fe0053", `x${BROKER_KEY}`, "agent:main:direct:owner", `agent:relay:pcp:grt_${"a".repeat(47)}`]) {
    assert.equal(isBrokerSessionKey(key), false, key);
  }
});

test("broker turns: tools read PCP's grant with the plugin credential, no local grant, no sync, no context, no claims", async () => {
  const { pcp, tools, hook } = setup({ linked: true });
  pcp.brokerGrants = new Map([[BROKER_KEY, { broker: true, home: "ses_home_wx", readable: ["ses_home_tg", "ses_home_wx"] }]]);
  const ctx = { agentId: "relay-owner", sessionKey: BROKER_KEY, sessionId: "sid-b", channelId: "webchat", trigger: "user" };
  assert.equal(await hook("before_prompt_build")({ prompt: "x", messages: [] }, ctx), undefined);
  hook("agent_end")({ messages: [{ role: "user", content: "hi", timestamp: 1 }, { role: "assistant", content: [{ type: "text", text: "yo" }] }] }, ctx);
  assert.equal(pcp.calls.length, 0, "no grant request, recall or sync for broker turns");

  const list = tools[0].factory({ agentId: "relay-owner", sessionKey: BROKER_KEY, messageChannel: "webchat" });
  const found = await list.find((t) => t.name === "pcp_search").execute("c1", { query: "dentist" });
  assert.match(found.content[0].text, /dentist/);
  const recalled = await list.find((t) => t.name === "pcp_context").execute("c2", { limit: 5 });
  assert.match(recalled.content[0].text, /telegram home message/);
  assert.deepEqual(pcp.calls.map((c) => c.pathname), ["/api/v1/service/search", "/api/v1/service/recall"]);
  for (const call of pcp.calls) {
    assert.equal(call.body.session_key, BROKER_KEY);
    assert.equal(call.auth, "Bearer pcps_test");
    assert.equal(call.body.principal, undefined);
  }
});

test("broker turns: an ended or foreign grant gives a clear tool error, never a fallback grant", async () => {
  const { pcp, tools } = setup({ linked: true });
  const list = tools[0].factory({ agentId: "relay", sessionKey: BROKER_KEY, messageChannel: "webchat" });
  const result = await list.find((t) => t.name === "pcp_context").execute("c", {});
  assert.equal(result.details.error, true);
  assert.deepEqual(pcp.calls.map((c) => c.pathname), ["/api/v1/service/recall"]);
});

test("HTTP backstop also covers broker turns: execution requires server authorization", async () => {
  const { hook } = setup();
  const before = hook("before_tool_call");
  for (const key of [BROKER_KEY, `agent:relay-owner:${BROKER_KEY}`]) {
    for (const tool of ["exec", "process", "read", "write", "browser", "web_fetch", "sessions_history", "message"]) {
      assert.equal((await before({ toolName: tool, params: {} }, { sessionKey: key, toolName: tool })).block, true, `${key} ${tool}`);
    }
    assert.equal(before({ toolName: "pcp_context", params: {} }, { sessionKey: key, toolName: "pcp_context" }), undefined);
  }
});


// ------------------------------------------------ owner-bound channels (0.2.1)
const WX_OWNER = "openclaw-weixin:wxid-test@im.wechat";
const OWNER_BOUND = { ownerBoundChannels: ["openclaw-weixin"], ownerPrincipals: [WX_OWNER] };
const strangerCtx = (key = "agent:main:direct:wxid-stranger@im.wechat") => ({ agentId: "main", sessionKey: key, sessionId: "sid-x", channelId: "openclaw-weixin", trigger: "user" });

test("owner binding: exact pinned principal only; other principals restricted; groups and other channels unchanged", () => {
  const bind = (key, channel, senderId) => applyOwnerBinding(target(key, channel, senderId), OWNER_BOUND);
  assert.equal(bind("agent:main:direct:owner", "openclaw-weixin").ownerBound, true);
  assert.equal(bind("agent:main:direct:owner", "openclaw-weixin").principal, WX_OWNER);
  const stranger = bind("agent:main:direct:wxid-other@im.wechat", "openclaw-weixin");
  assert.deepEqual([stranger.restricted, stranger.ownerBound], [true, undefined]);
  // Session keys are lowercased by OpenClaw; a case-only variant of the pin is not the owner.
  assert.equal(applyOwnerBinding({ principal: "openclaw-weixin:WXID-TEST@im.wechat", chat: "direct", channel: "openclaw-weixin" }, OWNER_BOUND).restricted, true);
  assert.equal(bind("agent:main:openclaw-weixin:direct:wxid-test@im.wechat", undefined).ownerBound, true, "per-channel key with the exact id");
  const tg = bind("agent:main:direct:owner", "telegram");
  assert.equal(tg.ownerBound, undefined);
  assert.equal(tg.restricted, undefined);
  assert.deepEqual(bind("agent:main:openclaw-weixin:group:g1", "openclaw-weixin", "wxid-test@im.wechat"), target("agent:main:openclaw-weixin:group:g1", "openclaw-weixin", "wxid-test@im.wechat"));
  assert.equal(applyOwnerBinding(null, OWNER_BOUND), null);
  assert.equal(applyOwnerBinding(target("agent:main:direct:owner", "openclaw-weixin"), {}).ownerBound, undefined, "off by default");
});

test("owner pins are validated: wrong channel, malformed and out-of-prefix entries are rejected", () => {
  const checked = checkOwnerPrincipals({
    ownerBoundChannels: ["openclaw-weixin", "discord"],
    ownerPrincipals: [WX_OWNER, "telegram:100000001", "openclaw-weixin:group:x", "nope", "discord:1"],
    allowedPrefixes: prefixes,
  });
  assert.deepEqual(checked.valid, [WX_OWNER]);
  assert.deepEqual(checked.rejected, ["telegram:100000001", "openclaw-weixin:group:x", "nope", "discord:1"]);
  assert.deepEqual(checked.unpinnedChannels, ["discord"]);
});

test("owner-bound WeChat owner: cross-channel context, never a claim (even if claims are enabled for the channel)", async () => {
  const { pcp, hook, warnings } = setup({ linked: true, pluginConfig: { ...OWNER_BOUND, claimChannels: ["telegram", "openclaw-weixin"] } });
  const result = await hook("before_prompt_build")({ prompt: "hi", messages: [] }, ownerCtx("openclaw-weixin"));
  assert.match(result.prependContext, /telegram home message/);
  const grant = pcp.calls.find((c) => c.pathname.endsWith("/grants"));
  assert.equal(grant.body.principal, WX_OWNER);
  assert.equal(grant.body.issue_claim, undefined);
  assert.equal(hook("message_sending")({ to: "wxid-test@im.wechat", content: "x" }, { channelId: "openclaw-weixin" }), undefined);
  assert.equal(warnings.length, 0);
});

test("owner-bound channel: the pinned owner not linked in PCP logs one warning and gets no claim", async () => {
  const { pcp, hook, warnings } = setup({ pluginConfig: { ...OWNER_BOUND, claimChannels: ["openclaw-weixin"] } });
  await hook("before_prompt_build")({ prompt: "hi", messages: [] }, ownerCtx("openclaw-weixin"));
  await hook("before_prompt_build")({ prompt: "hi", messages: [] }, ownerCtx("openclaw-weixin"));
  assert.ok(pcp.calls.every((c) => c.body.issue_claim === undefined));
  assert.equal(warnings.filter((w) => /PCP owner not linked/.test(w)).length, 1);
});

test("owner-bound channel: an unpinned principal is an unlinked sender (warned, no claim, home session only) even if PCP links it", async () => {
  const { pcp, hook, tools, warnings } = setup({ linked: true, pluginConfig: { ...OWNER_BOUND, claimChannels: ["openclaw-weixin"] } });
  const ctx = strangerCtx();
  assert.equal(await hook("before_prompt_build")({ prompt: "who am I", messages: [] }, ctx), undefined, "no cross-session context");
  const grant = pcp.calls.find((c) => c.pathname.endsWith("/grants"));
  assert.equal(grant.body.principal, "openclaw-weixin:wxid-stranger@im.wechat");
  assert.equal(grant.body.issue_claim, undefined);
  assert.equal(pcp.calls.filter((c) => c.pathname.endsWith("/recall")).length, 0);
  assert.ok(warnings.some((w) => /not a pinned owner principal/.test(w)));
  assert.ok(warnings.some((w) => /PCP links an unpinned/.test(w)));
  assert.ok(warnings.every((w) => !w.includes("wxid-stranger")), "warnings do not echo the sender id");

  const list = tools[0].factory({ agentId: "main", sessionKey: ctx.sessionKey, messageChannel: "openclaw-weixin" });
  const recalled = await list.find((t) => t.name === "pcp_context").execute("c1", {});
  assert.doesNotMatch(recalled.content[0].text, /telegram home message/);
  assert.match(recalled.content[0].text, /dentist/, "its own home session is still readable");
  const found = await list.find((t) => t.name === "pcp_search").execute("c2", { query: "telegram home" });
  assert.equal(found.details.count, 0);
});

test("owner-bound channel without a pin: every DM there is restricted, with a startup warning", async () => {
  const { hook, pcp, warnings } = setup({ linked: true, pluginConfig: { ownerBoundChannels: ["openclaw-weixin"] } });
  assert.ok(warnings.some((w) => /PCP owner pin missing/.test(w)));
  assert.equal(await hook("before_prompt_build")({ prompt: "hi", messages: [] }, ownerCtx("openclaw-weixin")), undefined);
  assert.equal(pcp.calls.filter((c) => c.pathname.endsWith("/recall")).length, 0);
});

test("owner-bound WeChat leaves Telegram claims, groups and the HTTP backstop unchanged", async () => {
  const { pcp, hook } = setup({ pluginConfig: OWNER_BOUND });
  await hook("before_prompt_build")({ prompt: "hello", messages: [] }, ownerCtx("telegram"));
  assert.equal(pcp.calls[0].body.issue_claim, true, "Telegram still gets claim links");
  await hook("before_prompt_build")({ prompt: "x", messages: [] }, { ...ownerCtx("openclaw-weixin"), sessionKey: "agent:main:openclaw-weixin:group:g1" });
  assert.equal(pcp.calls.length, 1, "groups: no grant, context or claim at prompt build");
  const before = hook("before_tool_call");
  assert.equal(before({ toolName: "exec", params: {} }, { sessionKey: "agent:main:openai:1", toolName: "exec" }).block, true);
});

test("execution backstop checks every tool against PCP and rejects outages or mismatched agents", async () => {
  let allowed = true, calls = 0;
  const hooks = new Map();
  createPlugin({ pluginConfig: { baseUrl: "http://127.0.0.1:3000" }, config: {}, logger: { warn() {} },
    on: (name, fn) => hooks.set(name, fn), registerTool() {}, registerService() {} }, {
    token: "test", queue: { due: () => [] }, fetch: async () => { calls++; return { ok: true, json: async () => ({ allowed, agent: "astrbot-exec" }) }; },
  });
  const ctx = { sessionKey: `agent:astrbot-exec:pcp:grt_${"a".repeat(48)}` };
  assert.equal(await hooks.get("before_tool_call")({ toolName: "exec" }, ctx), undefined);
  allowed = false;
  assert.equal((await hooks.get("before_tool_call")({ toolName: "exec" }, ctx)).block, true);
  allowed = true;
  assert.equal((await hooks.get("before_tool_call")({ toolName: "exec" }, { sessionKey: ctx.sessionKey.replace("astrbot-exec", "main") })).block, true);
  assert.equal(calls, 3);
});

test("inline user images are preserved for durable sync, including image-only messages", () => {
  const turn = extractTurn([{ role: "user", content: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }], timestamp: 123 }]);
  assert.equal(turn.messages[0].content, "[image]");
  assert.deepEqual(turn.messages[0].media, [{ name: "image-1", data: "aGVsbG8=" }]);
});
