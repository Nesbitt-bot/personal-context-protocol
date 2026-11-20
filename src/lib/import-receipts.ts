import { createHash } from 'node:crypto';
import { eq, max } from 'drizzle-orm';
import type { db } from './db';
import { importReceipts, messages } from './schema';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Receipt = typeof importReceipts.$inferSelect;

// Replays must match the original role, provider timestamp AND unmodified bytes.
// In particular, a later genuine turn repeating the same words is not suppressed.
export function receiptIndex(rows: Receipt[]) {
  const index = new Map(rows.map(r => [`${r.role}:${r.providerTimestamp.getTime()}:${r.contentSha256}`, r]));
  return (msg: {role: string; content: string; provider_timestamp?: string | null}) => {
    if (!index.size || !msg.provider_timestamp) return undefined;
    const digest = createHash('sha256').update(msg.content).digest('hex');
    return index.get(`${msg.role}:${Date.parse(msg.provider_timestamp)}:${digest}`);
  };
}

export async function lastImportOrdinal(tx: Tx, id: string) {
  const [live] = await tx.select({ n: max(messages.ordinal) }).from(messages).where(eq(messages.sessionId, id));
  const [retired] = await tx.select({ n: max(importReceipts.ordinal) }).from(importReceipts).where(eq(importReceipts.sessionId, id));
  return Math.max(live?.n ?? 0, retired?.n ?? 0);
}
