/**
 * Trusted-principal resolution from OpenClaw session keys.
 *
 * The principal always comes from the session key OpenClaw derived from the
 * platform peer (plus `session.identityLinks` from the gateway config and the
 * runtime channel id), never from message text or tool arguments.
 *
 * Session key shapes (src/routing/session-key.ts):
 *   agent:<agent>:direct:<peer>                     dmScope per-peer
 *   agent:<agent>:<channel>:direct:<peer>           per-channel-peer
 *   agent:<agent>:<channel>:<account>:direct:<peer> per-account-channel-peer
 *   agent:<agent>:<channel>:group:<id> / :channel:<id>
 *   agent:<agent>:openai:<uuid> / openai-user:<user> HTTP API (no principal)
 *   agent:<agent>:main, cron/heartbeat/subagent keys (unattributed)
 */

// Mirrors PCP src/lib/session-access.ts PRINCIPAL_PATTERN.
export const PRINCIPAL_PATTERN = /^[a-z][a-z0-9_-]{0,63}(:[A-Za-z0-9._@+=-]{1,128}){1,3}$/;
// HTTP API runs: OpenAI-compatible sessions and PCP broker turns
// (`pcp:<grant id>`, sent by the broker as x-openclaw-session-key).
export const DEFAULT_HTTP_SESSION_PATTERNS = ["^agent:[^:]+:openai(?:[-:]|$)", "(?:^|:)pcp:grt_"];

// Mirrors PCP src/lib/turn-grants.ts BROKER_SESSION_KEY_PATTERN.
export const BROKER_SESSION_KEY_PATTERN = /^(?:agent:[a-z0-9][a-z0-9_-]{0,63}:)?pcp:(grt_[0-9a-f]{48})$/i;

/** True for a PCP broker turn: PCP already holds that turn's grant. */
export function isBrokerSessionKey(sessionKey) {
  return typeof sessionKey === "string" && BROKER_SESSION_KEY_PATTERN.test(sessionKey);
}

export function compilePatterns(patterns) {
  return (patterns || []).map((pattern) => new RegExp(pattern));
}

export function isHttpSessionKey(sessionKey, compiled) {
  return typeof sessionKey === "string" && compiled.some((re) => re.test(sessionKey));
}

/** Split a session key into its routing parts; null when it is not a peer key. */
export function parseSessionKey(sessionKey) {
  if (typeof sessionKey !== "string" || !sessionKey.startsWith("agent:")) return null;
  const parts = sessionKey.split(":");
  const agentId = parts[1];
  const rest = parts.slice(2);
  if (!agentId || rest.length < 2) return null;
  const directAt = rest.indexOf("direct");
  if (directAt !== -1 && directAt <= 2 && directAt === rest.length - 2) {
    return { agentId, chat: "direct", channel: directAt >= 1 ? rest[0] : undefined, peer: rest[directAt + 1] };
  }
  if (rest.length === 3 && (rest[1] === "group" || rest[1] === "channel")) {
    return { agentId, chat: "group", channel: rest[0], groupId: rest[2] };
  }
  return null;
}

const channelOf = (principal) => principal.slice(0, principal.indexOf(":"));

/**
 * The PCP target (principal, chat, group) for a run, or null when the run has
 * no trusted principal (HTTP, main/cron sessions, unknown platforms).
 *
 * @param {object} p
 * @param {string} p.sessionKey
 * @param {string} [p.channel] runtime channel id (ctx.channelId / messageChannel)
 * @param {string} [p.senderId] trusted sender id (tool ctx requesterSenderId), groups only
 * @param {Record<string,string[]>} [p.identityLinks] gateway `session.identityLinks`
 * @param {string[]} p.allowedPrefixes principal prefixes the service credential may assert
 */
export function resolveTarget({ sessionKey, channel, senderId, identityLinks, allowedPrefixes }) {
  const parsed = parseSessionKey(sessionKey);
  if (!parsed) return null;
  const allowed = (principal) => typeof principal === "string" && PRINCIPAL_PATTERN.test(principal)
    && !principal.includes(":group:") && allowedPrefixes.some((prefix) => principal.startsWith(prefix));
  const runtimeChannel = typeof channel === "string" && channel ? channel : undefined;

  if (parsed.chat === "group") {
    if (!senderId) return null;
    const principal = `${parsed.channel}:${senderId}`;
    if (!allowed(principal) || !/^[A-Za-z0-9._@+=-]{1,128}$/.test(parsed.groupId)) return null;
    return { principal, chat: "group", groupId: parsed.groupId, channel: parsed.channel, peer: senderId };
  }

  const keyChannel = parsed.channel;
  if (keyChannel && runtimeChannel && keyChannel !== runtimeChannel) return null;
  const effectiveChannel = keyChannel || runtimeChannel;
  const links = identityLinks && Object.prototype.hasOwnProperty.call(identityLinks, parsed.peer)
    ? identityLinks[parsed.peer]
    : null;

  if (Array.isArray(links)) {
    // Canonical identity (e.g. "owner"): pick the linked id for this channel.
    const candidates = links.filter(allowed);
    const match = effectiveChannel
      ? candidates.filter((principal) => channelOf(principal) === effectiveChannel)
      : candidates;
    if (match.length !== 1) return null;
    const principal = match[0];
    return { principal, chat: "direct", channel: channelOf(principal), peer: principal.slice(principal.indexOf(":") + 1), linkedName: parsed.peer };
  }

  if (!effectiveChannel) return null;
  const principal = `${effectiveChannel}:${parsed.peer}`;
  if (!allowed(principal)) return null;
  return { principal, chat: "direct", channel: effectiveChannel, peer: parsed.peer };
}

/**
 * Owner-bound channels (operator decision, e.g. `openclaw-weixin`, which is
 * bound 1:1 to the owner's own account). A direct-chat target on such a
 * channel is the owner only when its principal is exactly one of the pinned
 * `ownerPrincipals` (case-sensitive; identityLinks keep the platform's case,
 * session keys are lowercased). Any other principal there is restricted: it
 * is treated as an unlinked sender (home session only), whatever PCP says.
 * Groups and other channels are returned unchanged.
 *
 * @returns {object|null} the target, plus `ownerBound: true` or `restricted: true`
 */
export function applyOwnerBinding(target, { ownerBoundChannels = [], ownerPrincipals = [] } = {}) {
  if (!target || target.chat !== "direct" || !ownerBoundChannels.includes(target.channel)) return target;
  if (ownerPrincipals.includes(target.principal)) return { ...target, ownerBound: true };
  return { ...target, restricted: true };
}

/**
 * Pinned owner principals that can apply: well-formed, on an owner-bound
 * channel and assertable by this credential. Returns { valid, rejected, unpinnedChannels }.
 */
export function checkOwnerPrincipals({ ownerBoundChannels = [], ownerPrincipals = [], allowedPrefixes = [] }) {
  const valid = [];
  const rejected = [];
  for (const principal of ownerPrincipals) {
    const ok = typeof principal === "string" && PRINCIPAL_PATTERN.test(principal) && !principal.includes(":group:")
      && ownerBoundChannels.includes(channelOf(principal)) && allowedPrefixes.some((prefix) => principal.startsWith(prefix));
    (ok ? valid : rejected).push(principal);
  }
  const unpinnedChannels = ownerBoundChannels.filter((channel) => !valid.some((principal) => channelOf(principal) === channel));
  return { valid, rejected, unpinnedChannels };
}
