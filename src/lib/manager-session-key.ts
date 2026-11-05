import { eq } from 'drizzle-orm';
import { db } from './db';
import { sessions } from './schema';
import { normalizeExternalKey } from './external-key';

/** Look up a session by external key for the global-scope project/sync APIs. */
export async function sessionByExternalKey(rawKey: string): Promise<{ id: string } | { error: string } | null> {
  let key: string | null;
  try {
    key = normalizeExternalKey(decodeURIComponent(rawKey));
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'invalid external key' };
  }
  if (!key) return { error: 'external key is required' };
  const [row] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.externalKey, key)).limit(1);
  return row || null;
}
