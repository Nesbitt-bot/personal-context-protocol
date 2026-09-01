import { eq } from 'drizzle-orm';
import { db } from './db';
import { scopedTokens } from './schema';
import { verifyToken } from './auth';

/**
 * Unified scoped-token vocabulary for the global token manager. A scoped token
 * generalizes the admin credential and the per-session token: it is bounded by
 * `scope` (global / folder / session) and carries fine-grained permission flags
 * so a consumer (e.g. the DSH sync worker) can hold least privilege.
 */

export type TokenScope = 'global' | 'folder' | 'session';

export interface ScopedPermissions {
  create_folders: boolean;
  delete_folders: boolean;
  create_sessions: boolean;
  delete_sessions: boolean;
  mint_tokens: boolean;
  rename_sessions: boolean;
  read_all: boolean;
}

export const PERMISSION_KEYS: readonly (keyof ScopedPermissions)[] = [
  'create_folders',
  'delete_folders',
  'create_sessions',
  'delete_sessions',
  'mint_tokens',
  'rename_sessions',
  'read_all',
] as const;

export const FULL_PERMISSIONS: ScopedPermissions = {
  create_folders: true,
  delete_folders: true,
  create_sessions: true,
  delete_sessions: true,
  mint_tokens: true,
  rename_sessions: true,
  read_all: true,
};

export function defaultPermissionsForScope(scope: TokenScope): ScopedPermissions {
  switch (scope) {
    case 'global':
      return { ...FULL_PERMISSIONS };
    case 'folder':
      return {
        create_folders: false,
        delete_folders: false,
        create_sessions: true,
        delete_sessions: true,
        mint_tokens: true,
        rename_sessions: true,
        read_all: true,
      };
    case 'session':
      return {
        create_folders: false,
        delete_folders: false,
        create_sessions: false,
        delete_sessions: false,
        mint_tokens: false,
        rename_sessions: false,
        read_all: false,
      };
  }
}

/**
 * Merge caller-supplied permission booleans over the scope defaults, then clamp
 * so a folder token can never grant folder-wide powers and a session token can
 * never grant cross-session powers.
 */
export function normalizePermissions(input: unknown, scope: TokenScope): ScopedPermissions {
  const base = defaultPermissionsForScope(scope);
  if (input && typeof input === 'object') {
    const record = input as Record<string, unknown>;
    for (const key of PERMISSION_KEYS) {
      if (typeof record[key] === 'boolean') base[key] = record[key] as boolean;
    }
  }
  if (scope === 'folder') {
    base.create_folders = false;
    base.delete_folders = false;
  }
  if (scope === 'session') {
    base.create_folders = false;
    base.delete_folders = false;
    base.create_sessions = false;
    base.delete_sessions = false;
    base.mint_tokens = false;
    base.read_all = false;
  }
  return base;
}

export interface ResolvedScopedToken {
  id: string;
  name: string;
  scope: TokenScope;
  folderId: string | null;
  sessionId: string | null;
  permissions: ScopedPermissions;
}

/**
 * Resolve a raw bearer token against `scoped_tokens`. Returns null when the
 * token is unknown, revoked, or expired. Updates `last_used_at` on success.
 */
export async function resolveScopedToken(token: string): Promise<ResolvedScopedToken | null> {
  const prefix = token.substring(0, 16);
  const candidates = await db
    .select()
    .from(scopedTokens)
    .where(eq(scopedTokens.tokenPrefix, prefix))
    .limit(10);

  for (const candidate of candidates) {
    const valid = await verifyToken(token, candidate.tokenHash, candidate.salt);
    if (!valid) continue;
    if (candidate.revoked) return null;
    if (candidate.expiresAt && candidate.expiresAt < new Date()) return null;

    await db.update(scopedTokens).set({ lastUsedAt: new Date() }).where(eq(scopedTokens.id, candidate.id));

    return {
      id: candidate.id,
      name: candidate.name,
      scope: candidate.scope as TokenScope,
      folderId: candidate.folderId ?? null,
      sessionId: candidate.sessionId ?? null,
      permissions: normalizePermissions(candidate.permissionsJson, candidate.scope as TokenScope),
    };
  }

  return null;
}
