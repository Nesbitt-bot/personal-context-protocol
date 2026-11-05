import crypto from 'crypto';
import { and, desc, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { db } from './db';
import { events, identities, sessions, turnGrants } from './schema';
import { createId } from './auth';
import { createClaim, ownerForPrincipal } from './claims';
import { credentialAllowsPrincipal, INGRESS_PREFIX, ResolvedServiceCredential } from './service-auth';
import { isValidPrincipal } from './session-access';

/**
 * Server-side turn grants. A channel plugin asks for a grant at the start of
 * a turn, naming the OpenClaw session key and the platform principal it saw
 * (from the platform, never from message text). PCP decides which sessions
 * that turn may read and stores the decision; the plugin later presents only
 * its own service credential plus the session key, so neither the model nor
 * the plugin can widen it.
 *
 * - Direct chat, principal linked to a user: the user's own non-group
 *   sessions (owned or principal-linked, as a non-admin would see them).
 * - Direct chat, unlinked principal: only that principal's own DM session.
 * - Group chat: only the group's own session.
 * Writes always go to the grant's home session only.
 *
 * Broker grants (origin `broker`, design Phase 4) are created by the PCP
 * broker for one AstrBot turn. Their session key is `pcp:<grant id>`, which
 * the broker sends to OpenClaw as `x-openclaw-session-key`; the openclaw-pcp
 * plugin's tools then present their own (delegate) credential plus that key.
 * Delegates may read, never write. `astrbot:` principals exist only in broker
 * grants, i.e. only behind a verified, signed AstrBot stamp.
 */

export const DEFAULT_GRANT_TTL_SECONDS = 600;
export const MIN_GRANT_TTL_SECONDS = 30;
export const MAX_GRANT_TTL_SECONDS = 3600;
export const MAX_READABLE_SESSIONS = 500;

export function clampGrantTtl(seconds: number | undefined): number {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return DEFAULT_GRANT_TTL_SECONDS;
  return Math.min(MAX_GRANT_TTL_SECONDS, Math.max(MIN_GRANT_TTL_SECONDS, Math.floor(seconds)));
}

/**
 * The group's own principal: the sender's platform part plus the group id,
 * e.g. `telegram:123` -> `telegram:group:-100`, `astrbot:qq:1` -> `astrbot:qq:group:7`.
 */
export function groupPrincipalFor(senderPrincipal: string, groupId: string): string {
  const platform = senderPrincipal.split(':').slice(0, -1).join(':');
  return `${platform}:group:${groupId}`;
}

/** `pcp:<grant id>` (optionally as OpenClaw stores it, `agent:<id>:pcp:<grant id>`). */
export const BROKER_SESSION_KEY_PATTERN = /^(?:agent:[a-z0-9][a-z0-9_-]{0,63}:)?pcp:(grt_[0-9a-f]{48})$/i;

/** A fresh, unguessable broker grant id (`grt_` + 48 hex). */
export function newBrokerGrantId(): string {
  return `grt_${crypto.randomBytes(24).toString('hex')}`;
}

export function brokerSessionKey(grantId: string): string {
  return `pcp:${grantId}`;
}

/** The broker grant id in a session key, or null for ordinary keys. */
export function brokerGrantIdFromSessionKey(sessionKey: string): string | null {
  const match = typeof sessionKey === 'string' ? BROKER_SESSION_KEY_PATTERN.exec(sessionKey) : null;
  return match ? match[1].toLowerCase() : null;
}

export interface GrantRequest {
  sessionKey: string;
  principal: string;
  chat: 'direct' | 'group';
  groupId?: string;
  ttlSeconds?: number;
  issueClaim?: boolean;
  /** Broker grants only. */
  broker?: { grantId: string; agent: string; brokerCredentialId: string; delegateCredentialId: string | null; externalKey: string };
}

export type GrantResult =
  | {
    ok: true;
    grantId: string;
    homeSessionId: string;
    readableSessionIds: string[];
    expiresAt: Date;
    linkedUserId: string | null;
    claim: { code: string; expiresAt: Date } | null;
  }
  | { ok: false; status: number; code: string; error: string };

async function ensureHomeSession(externalKey: string, title: string, principal: string, sessionClass: 'trusted' | 'group', ownerUserId: string | null, now: Date) {
  await db.execute(sql`
    INSERT INTO sessions (id, external_key, title, principal, class, owner_user_id, created_at, updated_at)
    VALUES (${createId('ses')}, ${externalKey}, ${title}, ${principal}, ${sessionClass}, ${ownerUserId}, ${now.toISOString()}, ${now.toISOString()})
    ON CONFLICT (external_key) WHERE external_key IS NOT NULL DO NOTHING
  `);
  const [home] = await db
    .select({ id: sessions.id, ownerUserId: sessions.ownerUserId, sessionClass: sessions.sessionClass, principal: sessions.principal, archived: sessions.archived })
    .from(sessions)
    .where(eq(sessions.externalKey, externalKey))
    .limit(1);
  return home;
}

export async function createTurnGrant(credential: ResolvedServiceCredential, input: GrantRequest, now = new Date()): Promise<GrantResult> {
  const fail = (status: number, code: string, cause: string): GrantResult => ({
    ok: false, status, code, error: `Unable to create turn grant: service sync / turn grant - ${cause}`,
  });

  if (!isValidPrincipal(input.principal)) return fail(400, 'INVALID_PRINCIPAL', 'principal must look like platform:id');
  // `:group:` is reserved for group principals derived below.
  if (input.principal.includes(':group:')) return fail(400, 'INVALID_PRINCIPAL', 'a sender principal cannot contain ":group:"');
  if (!credentialAllowsPrincipal(credential.principalPrefixes, input.principal)) {
    return fail(403, 'PRINCIPAL_NOT_ALLOWED', 'this service credential may not assert principals of that platform');
  }
  if (input.principal.startsWith(INGRESS_PREFIX) && !input.broker) {
    return fail(403, 'PRINCIPAL_NOT_ALLOWED', `${INGRESS_PREFIX} principals are only accepted from a signed AstrBot stamp through the broker`);
  }
  if (input.broker && input.sessionKey !== brokerSessionKey(input.broker.grantId)) {
    return fail(400, 'VALIDATION_ERROR', 'a broker grant uses the session key pcp:<grant id>');
  }
  if (!input.broker && brokerGrantIdFromSessionKey(input.sessionKey)) {
    return fail(400, 'VALIDATION_ERROR', 'pcp:<grant id> session keys are reserved for broker grants');
  }

  let homePrincipal = input.principal;
  let externalKey: string;
  let title: string;
  let sessionClass: 'trusted' | 'group';
  let ownerUserId: string | null = null;

  if (input.chat === 'group') {
    if (!input.groupId) return fail(400, 'VALIDATION_ERROR', 'group chats need group_id');
    homePrincipal = groupPrincipalFor(input.principal, input.groupId);
    if (!isValidPrincipal(homePrincipal)) return fail(400, 'VALIDATION_ERROR', 'group_id has unsupported characters');
    externalKey = `pcp:group:${homePrincipal}`;
    title = `Group ${homePrincipal}`;
    sessionClass = 'group';
  } else {
    externalKey = `pcp:dm:${input.principal}`;
    title = `Chat ${input.principal}`;
    sessionClass = 'trusted';
    ownerUserId = await ownerForPrincipal(input.principal);
  }

  const home = await ensureHomeSession(externalKey, title, homePrincipal, sessionClass, ownerUserId, now);
  if (!home) return fail(500, 'INTERNAL_ERROR', 'home session could not be created');
  if (home.sessionClass !== sessionClass) return fail(409, 'SESSION_CLASS_MISMATCH', 'the home session has a different class');
  if (home.archived) return fail(409, 'SESSION_ARCHIVED', 'the home session is archived');

  // Later sessions of a linked principal are owned automatically.
  if (sessionClass === 'trusted' && ownerUserId && !home.ownerUserId) {
    await db.update(sessions).set({ ownerUserId, updatedAt: now }).where(eq(sessions.id, home.id));
  }

  let readable = [home.id];
  if (sessionClass === 'trusted' && ownerUserId) {
    const linked = db.select({ principal: identities.principal }).from(identities).where(eq(identities.userId, ownerUserId));
    const rows = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(
        ne(sessions.sessionClass, 'group'),
        eq(sessions.archived, false),
        or(eq(sessions.ownerUserId, ownerUserId), inArray(sessions.principal, linked)),
      ))
      .orderBy(desc(sessions.lastMessageAt), desc(sessions.createdAt))
      .limit(MAX_READABLE_SESSIONS);
    readable = Array.from(new Set([home.id, ...rows.map((row) => row.id)]));
  }

  const ttl = clampGrantTtl(input.ttlSeconds);
  const expiresAt = new Date(now.getTime() + ttl * 1000);
  const grantId = input.broker ? input.broker.grantId : createId('grt');

  // One live grant per (credential, session key): a new turn replaces the last.
  await db.update(turnGrants).set({ revokedAt: now }).where(and(
    eq(turnGrants.credentialId, credential.id),
    eq(turnGrants.sessionKey, input.sessionKey),
    isNull(turnGrants.revokedAt),
  ));
  await db.insert(turnGrants).values({
    id: grantId,
    credentialId: credential.id,
    sessionKey: input.sessionKey,
    principal: input.principal,
    homeSessionId: home.id,
    readableSessionIdsJson: readable,
    createdAt: now,
    expiresAt,
    origin: input.broker ? 'broker' : 'service',
    agent: input.broker?.agent ?? null,
    delegateCredentialId: input.broker?.delegateCredentialId ?? null,
    externalKey: input.broker?.externalKey ?? null,
    brokerCredentialId: input.broker?.brokerCredentialId ?? null,
  });

  let claim: { code: string; expiresAt: Date } | null = null;
  if (input.issueClaim && sessionClass === 'trusted' && !ownerUserId) {
    const issued = await createClaim(home.id, input.principal, now);
    if (issued.ok) claim = { code: issued.code, expiresAt: issued.expiresAt };
  }

  await db.insert(events).values({
    id: createId('evt'),
    sessionId: home.id,
    action: 'grant.created',
    actor: `service:${credential.id}`,
    detailsJson: { grant_id: grantId, principal: input.principal, chat: input.chat, readable_count: readable.length, ttl_seconds: ttl, claim_issued: Boolean(claim), ...(input.broker ? { origin: 'broker', agent: input.broker.agent } : {}) },
    createdAt: now,
  });

  return { ok: true, grantId, homeSessionId: home.id, readableSessionIds: readable, expiresAt, linkedUserId: ownerUserId, claim };
}

export interface ActiveGrant {
  id: string;
  principal: string;
  homeSessionId: string;
  readableSessionIds: string[];
  expiresAt: Date;
  origin: 'service' | 'broker';
  agent: string | null;
  externalKey: string | null;
  /** True when a delegate (not the grant's own credential) is reading it. */
  delegated: boolean;
}

function toActiveGrant(grant: typeof turnGrants.$inferSelect, credentialId: string): ActiveGrant {
  const readable = Array.isArray(grant.readableSessionIdsJson)
    ? (grant.readableSessionIdsJson as unknown[]).filter((id): id is string => typeof id === 'string')
    : [];
  return {
    id: grant.id,
    principal: grant.principal,
    homeSessionId: grant.homeSessionId,
    readableSessionIds: readable,
    expiresAt: grant.expiresAt,
    origin: grant.origin === 'broker' ? 'broker' : 'service',
    agent: grant.agent ?? null,
    externalKey: grant.externalKey ?? null,
    delegated: grant.credentialId !== credentialId,
  };
}

/**
 * The live grant for this credential and session key, or null. A broker key
 * (`pcp:<grant id>`) resolves to that broker grant for its own credential or
 * its delegate only.
 */
export async function findActiveGrant(credentialId: string, sessionKey: string, now = new Date()): Promise<ActiveGrant | null> {
  const brokerGrantId = brokerGrantIdFromSessionKey(sessionKey);
  if (brokerGrantId) {
    const [grant] = await db
      .select()
      .from(turnGrants)
      .where(and(
        eq(turnGrants.id, brokerGrantId),
        eq(turnGrants.origin, 'broker'),
        or(eq(turnGrants.credentialId, credentialId), eq(turnGrants.delegateCredentialId, credentialId)),
        isNull(turnGrants.revokedAt),
        gt(turnGrants.expiresAt, now),
      ))
      .limit(1);
    return grant ? toActiveGrant(grant, credentialId) : null;
  }
  const [grant] = await db
    .select()
    .from(turnGrants)
    .where(and(
      eq(turnGrants.credentialId, credentialId),
      eq(turnGrants.sessionKey, sessionKey),
      eq(turnGrants.origin, 'service'),
      isNull(turnGrants.revokedAt),
      gt(turnGrants.expiresAt, now),
    ))
    .orderBy(desc(turnGrants.createdAt))
    .limit(1);
  return grant ? toActiveGrant(grant, credentialId) : null;
}

/** End one grant by id (the broker ends its grant when the turn ends). */
export async function revokeGrantById(grantId: string, now = new Date()) {
  const rows = await db.update(turnGrants).set({ revokedAt: now }).where(and(eq(turnGrants.id, grantId), isNull(turnGrants.revokedAt))).returning({ id: turnGrants.id });
  return rows.length;
}

/** Explicitly end a grant (e.g. at the end of the turn). */
export async function revokeGrant(credentialId: string, sessionKey: string, now = new Date()) {
  const rows = await db.update(turnGrants).set({ revokedAt: now }).where(and(
    eq(turnGrants.credentialId, credentialId),
    eq(turnGrants.sessionKey, sessionKey),
    isNull(turnGrants.revokedAt),
  )).returning({ id: turnGrants.id });
  return rows.length;
}
