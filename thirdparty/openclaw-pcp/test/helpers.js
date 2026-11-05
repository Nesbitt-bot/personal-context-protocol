import { createPlugin } from "../index.js";
import { DiskQueue } from "../lib/queue.js";

export const OWNER_LINKS = { owner: ["telegram:100000001", "openclaw-weixin:wxid-test@im.wechat"] };

/** In-memory PCP service API with the same request/response shapes. */
export function fakePcp({ linked = false } = {}) {
  const state = {
    down: false, delayMs: 0, calls: [], grants: new Map(), synced: new Map(), messages: [], seq: 0,
    sessions: [{ id: "ses_home_tg", title: "Chat telegram:100000001" }, { id: "ses_home_wx", title: "Chat openclaw-weixin:wxid-test@im.wechat" }],
  };
  state.messages.push({ session_id: "ses_home_wx", ordinal: 1, role: "user", content: "WeChat: remind me about the dentist on Friday", created_at: "2026-11-05T10:00:00Z" });
  state.messages.push({ session_id: "ses_home_tg", ordinal: 1, role: "user", content: "telegram home message", created_at: "2026-11-05T10:01:00Z" });
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
  state.fetch = async (url, init) => {
    const pathname = new URL(url).pathname;
    const body = JSON.parse(init.body);
    state.calls.push({ pathname, body, auth: init.headers.authorization });
    if (state.delayMs) await new Promise((resolve) => setTimeout(resolve, state.delayMs));
    if (state.down) throw Object.assign(new Error("connect ECONNREFUSED"), { name: "TypeError" });
    if (init.headers.authorization !== "Bearer pcps_test") return json(401, { code: "UNAUTHORIZED" });
    if (pathname === "/api/v1/service/grants") {
      if (!body.principal.startsWith("telegram:") && !body.principal.startsWith("openclaw-weixin:")) return json(403, { code: "PRINCIPAL_NOT_ALLOWED" });
      const home = body.principal.startsWith("telegram:") ? "ses_home_tg" : "ses_home_wx";
      const grant = { principal: body.principal, home, readable: linked ? ["ses_home_tg", "ses_home_wx"] : [home] };
      state.grants.set(body.session_key, grant);
      const claim = body.issue_claim && !linked ? { code: "CODE123", claim_url: "https://pcp.example.test/claim?code=CODE123", expires_at: new Date(Date.now() + 9e5).toISOString() } : null;
      return json(200, { grant_id: `grt_${++state.seq}`, session_id: home, readable_session_ids: grant.readable, expires_at: new Date(Date.now() + 6e5).toISOString(), linked, claim });
    }
    const grant = state.grants.get(body.session_key);
    if (!grant) return json(403, { code: "GRANT_REQUIRED" });
    if (pathname === "/api/v1/service/sync") {
      if (state.synced.has(body.external_key)) return json(200, { success: true, duplicate: true });
      state.synced.set(body.external_key, { home: grant.home, messages: body.messages });
      return json(200, { success: true, duplicate: false, session_id: grant.home });
    }
    if (pathname === "/api/v1/service/recall") {
      const rows = state.messages.filter((m) => grant.readable.includes(m.session_id)).slice(-(body.limit || 30));
      return json(200, { home_session_id: grant.home, sessions: state.sessions.filter((s) => grant.readable.includes(s.id)), messages: rows });
    }
    if (pathname === "/api/v1/service/search") {
      const q = body.query.toLowerCase();
      return json(200, { results: state.messages.filter((m) => grant.readable.includes(m.session_id) && m.content.toLowerCase().includes(q)) });
    }
    return json(404, { code: "NOT_FOUND" });
  };
  return state;
}

export function fakeApi(pluginConfig = {}, { identityLinks = OWNER_LINKS } = {}) {
  const hooks = new Map();
  const tools = [];
  const warnings = [];
  const api = {
    pluginConfig: { baseUrl: "http://127.0.0.1:3000", tokenFile: "/nonexistent", ...pluginConfig },
    config: { session: { dmScope: "per-peer", identityLinks } },
    logger: { warn: (m) => warnings.push(m), info: () => undefined, error: (m) => warnings.push(m) },
    on: (name, handler, opts) => { hooks.set(name, { handler, opts }); },
    registerTool: (factory, opts) => tools.push({ factory, opts }),
  };
  return { api, hooks, tools, warnings, hook: (name) => hooks.get(name).handler };
}

export function setup({ linked = false, pluginConfig = {}, token = "pcps_test" } = {}) {
  const pcp = fakePcp({ linked });
  const harness = fakeApi(pluginConfig);
  const queue = new DiskQueue({ file: null, logger: harness.api.logger });
  const plugin = createPlugin(harness.api, { fetch: pcp.fetch, token, queue, startTimer: false });
  return { pcp, ...harness, queue, plugin };
}

export const ownerCtx = (channelId = "telegram") => ({ agentId: "main", sessionKey: "agent:main:direct:owner", sessionId: "sid-1", channelId, trigger: "user" });
