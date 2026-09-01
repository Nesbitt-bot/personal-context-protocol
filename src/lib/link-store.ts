import { and, eq, inArray, or } from 'drizzle-orm';
import { db } from './db';
import { sessionLinks, sessions } from './schema';
import { createId } from './auth';

/** Reusable session-link helpers shared by the admin and manager link routes. */

export async function listSessionLinks(sessionId: string) {
  const rows = await db
    .select()
    .from(sessionLinks)
    .where(or(eq(sessionLinks.sessionA, sessionId), eq(sessionLinks.sessionB, sessionId)));

  const otherIds = rows.map((r) => (r.sessionA === sessionId ? r.sessionB : r.sessionA));
  const linked = otherIds.length
    ? await db.select({ id: sessions.id, title: sessions.title }).from(sessions).where(inArray(sessions.id, otherIds))
    : [];
  const titleById = new Map(linked.map((s) => [s.id, s.title]));

  return rows.map((r) => {
    const otherId = r.sessionA === sessionId ? r.sessionB : r.sessionA;
    return {
      id: r.id,
      other_session_id: otherId,
      other_title: titleById.get(otherId) ?? null,
      label: r.label ?? null,
      created_at: r.createdAt,
    };
  });
}

/** Return the topic id of a session, or undefined when the session is absent. */
export async function sessionTopicId(sessionId: string): Promise<string | null | undefined> {
  const [row] = await db.select({ topicId: sessions.topicId }).from(sessions).where(eq(sessions.id, sessionId));
  return row?.topicId ?? undefined;
}

export async function createSessionLink(a: string, b: string, label?: string) {
  const sessionA = a < b ? a : b;
  const sessionB = a < b ? b : a;

  const [existing] = await db
    .select()
    .from(sessionLinks)
    .where(and(eq(sessionLinks.sessionA, sessionA), eq(sessionLinks.sessionB, sessionB)));
  if (existing) {
    return { id: existing.id, label: existing.label ?? null, created_at: existing.createdAt, duplicate: true };
  }

  const id = createId('lnk');
  const now = new Date();
  await db.insert(sessionLinks).values({ id, sessionA, sessionB, label: label ?? null, createdAt: now });
  return { id, label: label ?? null, created_at: now.toISOString(), duplicate: false };
}

export async function deleteSessionLink(linkId: string) {
  await db.delete(sessionLinks).where(eq(sessionLinks.id, linkId));
}
