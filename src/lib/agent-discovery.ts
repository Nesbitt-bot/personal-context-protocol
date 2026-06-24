/**
 * Anonymous protocol discovery for agent routes.
 *
 * The recording URL and protocol endpoint are public: they expose only
 * non-secret session information (the session id and the upload routes) so an
 * agent can learn where to POST before presenting its token. Writing still
 * requires the access token.
 */

import { eq } from 'drizzle-orm';
import { db } from './db';
import { sessions } from './schema';
import { buildAgentProtocol } from './agent-protocol';
import { buildRecordingUrl, resolveAppBaseUrl } from './recording-url';
import { agentErrorBody, type AgentErrorBody } from './agent-errors';

export async function buildDiscovery(
  sessionId: string,
  requestOrigin?: string | null,
): Promise<{ status: number; body: AgentErrorBody | Record<string, unknown> }> {
  const [session] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.id, sessionId));

  if (!session) {
    return agentErrorBody('NOT_FOUND');
  }

  const base = resolveAppBaseUrl(requestOrigin);
  const protocol = buildAgentProtocol(sessionId);

  return {
    status: 200,
    body: {
      ...protocol,
      recording_url: base ? buildRecordingUrl(base, sessionId) : null,
    },
  };
}
