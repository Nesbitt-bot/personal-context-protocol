/**
 * Agent protocol descriptor.
 *
 * Returned (publicly, no token required) from the recording URL and the
 * protocol endpoint so an AI agent can discover where and how to upload using
 * only a recording URL + access token. This is intentionally self-describing:
 * the agent should read `routes` and `auth` rather than hard-coding paths.
 */

export const PROTOCOL_NAME = 'personal-context-protocol';
export const PROTOCOL_VERSION = '0.1';

/** Hard limits enforced by the agent ingestion routes. */
export const MAX_MESSAGES_PER_REQUEST = 50;
export const MAX_CONTENT_CHARS = 100_000;

export interface AgentProtocol {
  protocol: string;
  version: string;
  session_id: string;
  auth: { type: 'bearer'; header: string };
  routes: {
    record_messages: string;
    record_compact: string;
    ingest_any: string;
    review: string;
  };
  allowed_actions: {
    append_messages: boolean;
    read_context: boolean;
    rename_session: boolean;
    manage_topics: boolean;
    rewrite_messages: boolean;
    delete_messages: boolean;
  };
  limits: {
    max_messages_per_request: number;
    max_content_chars: number;
  };
}

/**
 * Build the protocol descriptor for a session. `canRenameSession` reflects the
 * scope of the token when known (discovery is anonymous, so it defaults to the
 * capability being available subject to token scope at write time).
 */
export function buildAgentProtocol(
  sessionId: string,
  options: { canRenameSession?: boolean } = {},
): AgentProtocol {
  return {
    protocol: PROTOCOL_NAME,
    version: PROTOCOL_VERSION,
    session_id: sessionId,
    auth: {
      type: 'bearer',
      header: 'Authorization: Bearer <access-token>',
    },
    routes: {
      record_messages: `/api/v1/agent/sessions/${sessionId}/messages`,
      record_compact: `/api/v1/agent/sessions/${sessionId}/compact`,
      ingest_any: `/api/v1/agent/sessions/${sessionId}/ingest`,
      review: `/api/v1/sessions/${sessionId}/review`,
    },
    allowed_actions: {
      append_messages: true,
      read_context: true,
      rename_session: options.canRenameSession ?? true,
      manage_topics: false,
      rewrite_messages: false,
      delete_messages: false,
    },
    limits: {
      max_messages_per_request: MAX_MESSAGES_PER_REQUEST,
      max_content_chars: MAX_CONTENT_CHARS,
    },
  };
}

/**
 * Build the copy-paste agent instruction block the human hands to an AI agent.
 * Requires only the recording URL and access token.
 */
export function buildAgentInstruction(recordingUrl: string, accessToken: string): string {
  return [
    'You are recording this conversation to Personal Context Protocol.',
    '',
    'Recording URL:',
    recordingUrl,
    '',
    'Access Token:',
    accessToken,
    '',
    'First fetch the recording URL or protocol endpoint to discover upload routes.',
    'Use Authorization: Bearer <access-token>.',
    'Record messages faithfully. If exact upload fails, retry ingest_any. If full upload is impossible, send a compact block.',
    'Do not manage topics. Do not rewrite or delete old messages. Do not claim success unless the server returns success.',
  ].join('\n');
}
