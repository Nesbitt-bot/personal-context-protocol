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

export type RecordingMode = 'wild' | 'exact';
export const DEFAULT_RECORDING_MODE: RecordingMode = 'wild';

/** Guidance shown to the agent for each recording mode. */
export const RECORDING_GUIDANCE: Record<RecordingMode, string> = {
  wild:
    'Recording mode is "wild". If recording a value verbatim could leak a secret, credential, API key, or other sensitive data, you may redact it with a placeholder like <REDACTED> or paraphrase it. Record the substance faithfully; prioritize safety over verbatim fidelity.',
  exact:
    'Recording mode is "exact". Record messages verbatim, including credentials and sensitive values, because this session is being captured for faithful future task migration. Do not redact or paraphrase.',
};

export function normalizeRecordingMode(value: unknown): RecordingMode {
  return value === 'exact' ? 'exact' : 'wild';
}

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
    read_messages: string;
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
  recording_mode: RecordingMode;
  recording_guidance: string;
}

/**
 * Build the protocol descriptor for a session. `canRenameSession` reflects the
 * scope of the token when known (discovery is anonymous, so it defaults to the
 * capability being available subject to token scope at write time).
 */
export function buildAgentProtocol(
  sessionId: string,
  options: { canRenameSession?: boolean; mode?: RecordingMode } = {},
): AgentProtocol {
  const mode = options.mode ?? DEFAULT_RECORDING_MODE;
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
      read_messages: `/api/v1/agent/sessions/${sessionId}/review`,
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
    recording_mode: mode,
    recording_guidance: RECORDING_GUIDANCE[mode],
  };
}

/**
 * Build the copy-paste agent instruction block the human hands to an AI agent.
 * Requires only the recording URL and access token.
 */
export function buildAgentInstruction(
  recordingUrl: string,
  accessToken: string,
  mode: RecordingMode = DEFAULT_RECORDING_MODE,
): string {
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
    `Then fetch ${recordingUrl} (or the read_messages route from the protocol) to read any messages already recorded in this session, so you know the full conversation history.`,
    '',
    'Record ALL messages from this conversation — every user message and every assistant response, including this one. Do not record only the current exchange; include the full history. If the session already has messages (from your read_messages fetch), pick up from the next ordinal.',
    'Use Authorization: Bearer <access-token>.',
    'Record messages faithfully. If exact upload fails, retry ingest_any. If full upload is impossible, send a compact block.',
    `Recording mode: ${mode}. ${RECORDING_GUIDANCE[mode]}`,
    'Do not manage topics. Do not rewrite or delete old messages. Do not claim success unless the server returns success.',
  ].join('\n');
}
