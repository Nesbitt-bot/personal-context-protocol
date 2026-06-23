import { db } from '@/lib/db';
import { generateSalt, hashToken } from '@/lib/auth';
import { uiAuth } from '@/lib/schema';
import { eq, sql } from 'drizzle-orm';

export const ADMIN_TOKEN_ENV = 'PCP_ADMIN_TOKEN';
const MIN_ADMIN_TOKEN_LENGTH = 32;

export function configuredAdminToken() {
  return process.env[ADMIN_TOKEN_ENV]?.trim() || '';
}

export function validateAdminToken(token: string) {
  if (token.trim().length < MIN_ADMIN_TOKEN_LENGTH) {
    return `admin token must be at least ${MIN_ADMIN_TOKEN_LENGTH} characters`;
  }
  return '';
}

/**
 * Returns whether the database already has the single admin credential row.
 */
export async function adminCredentialExists() {
  const [stored] = await db
    .select({ id: uiAuth.id })
    .from(uiAuth)
    .where(eq(uiAuth.id, 'ui_1'))
    .limit(1);

  return Boolean(stored);
}

/**
 * Stores a UI/admin token as a salted hash. The plaintext token is accepted only
 * at the API/env boundary and is never returned or logged by this helper.
 */
export async function storeAdminToken(token: string) {
  const validationError = validateAdminToken(token);
  if (validationError) {
    throw new Error(validationError);
  }

  const salt = generateSalt();
  const tokenHash = await hashToken(token.trim(), salt);

  await db.execute(sql`
    INSERT INTO ui_auth (id, token_hash, salt, created_at, updated_at)
    VALUES ('ui_1', ${tokenHash}, ${salt}, now(), now())
    ON CONFLICT (id) DO UPDATE SET
      token_hash = EXCLUDED.token_hash,
      salt = EXCLUDED.salt,
      updated_at = now()
  `);
}

/**
 * Applies a manually configured deployment admin token to the database. This is
 * the safe recovery path for a lost UI token: set PCP_ADMIN_TOKEN in Vercel and
 * redeploy, then log in with that value.
 */
export async function reconcileConfiguredAdminToken() {
  const token = configuredAdminToken();
  if (!token) {
    return { configured: false, applied: false };
  }

  await storeAdminToken(token);
  return { configured: true, applied: true };
}
