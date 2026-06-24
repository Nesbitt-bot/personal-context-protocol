/**
 * Admin-side session helpers shared by the session routes. Sessions may be
 * uncategorized (no topic), so the "same group" predicate is null-aware: a
 * session's siblings are the other sessions under the same topic, or the other
 * topic-less sessions when its topic is null.
 */

import { and, eq, isNull, ne } from 'drizzle-orm';
import { db } from './db';
import { sessions } from './schema';
import { DEFAULT_SESSION_TITLE, generateUniqueTitle } from './naming';

/** Filter matching the same topic group, treating null as "uncategorized". */
export function sameTopicGroup(topicId: string | null) {
  return topicId === null ? isNull(sessions.topicId) : eq(sessions.topicId, topicId);
}

/**
 * Generate a unique, auto-suffixed session title within its topic group (or the
 * uncategorized group). `excludeSessionId` omits the session being renamed.
 */
export async function uniqueSessionTitle(
  topicId: string | null,
  requested: string | undefined,
  excludeSessionId?: string,
): Promise<string> {
  const where = excludeSessionId
    ? and(sameTopicGroup(topicId), ne(sessions.id, excludeSessionId))
    : sameTopicGroup(topicId);

  const siblings = await db.select({ title: sessions.title }).from(sessions).where(where);
  return generateUniqueTitle(requested, siblings.map((row) => row.title), DEFAULT_SESSION_TITLE);
}
