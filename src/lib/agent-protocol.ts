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

export type RecordingMode = 'wild' | 'exact';
export const DEFAULT_RECORDING_MODE: RecordingMode = 'wild';

export const RECORDING_GUIDANCE: Record<RecordingMode, string> = {
  wild:
    'Recording mode is "wild". If recording a value verbatim could leak a secret, credential, API key, or other sensitive data, you may redact it with a placeholder like <REDACTED> or paraphrase it. Record the substance faithfully; prioritize safety over verbatim fidelity.',
  exact:
    'Recording mode is "exact". Record messages verbatim, including credentials and sensitive values, because this session is being captured for faithful future task migration. Do not redact or paraphrase.',
};

export function normalizeRecordingMode(value: unknown): RecordingMode {
  return value === 'exact' ? 'exact' : 'wild';
}

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
  schemas: {
    message: string;
    compact: string;
    ingest: string;
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

export function buildAgentProtocol(
  sessionId: string,
  options: { canRenameSession?: boolean; mode?: RecordingMode } = {},
): AgentProtocol {
  const mode = options.mode ?? DEFAULT_RECORDING_MODE;
  return {
    protocol: PROTOCOL_NAME,
    version: PROTOCOL_VERSION,
    session_id: sessionId,
    auth: { type: 'bearer', header: 'Authorization: Bearer <access-token>' },
    routes: {
      record_messages: `/api/v1/agent/sessions/${sessionId}/messages`,
      record_compact: `/api/v1/agent/sessions/${sessionId}/compact`,
      ingest_any: `/api/v1/agent/sessions/${sessionId}/ingest`,
      read_messages: `/api/v1/agent/sessions/${sessionId}/review`,
      review: `/api/v1/sessions/${sessionId}/review`,
    },
    schemas: {
      message: '/api/v1/agent/schema/message',
      compact: '/api/v1/agent/schema/compact',
      ingest: '/api/v1/agent/schema/ingest',
    },
    allowed_actions: {
      append_messages: true,
      read_context: true,
      rename_session: options.canRenameSession ?? true,
      manage_topics: false,
      rewrite_messages: false,
      delete_messages: false,
    },
    limits: { max_messages_per_request: MAX_MESSAGES_PER_REQUEST, max_content_chars: MAX_CONTENT_CHARS },
    recording_mode: mode,
    recording_guidance: RECORDING_GUIDANCE[mode],
  };
}

/** Default token instruction. */
export function buildAgentInstruction(
  recordingUrl: string,
  accessToken: string,
  mode: RecordingMode = DEFAULT_RECORDING_MODE,
): string {
  return [
    'You are recording this conversation to Personal Context Protocol.',
    '',
    'Recording URL:', recordingUrl,
    '', 'Access Token:', accessToken, '',
    'First fetch the recording URL or protocol endpoint to discover upload routes.',
    `Then fetch read_messages to read any messages already recorded in this session, so you know the full conversation history.`,
    'Record ALL messages from this conversation — every user message and every assistant response, including this one. Include the full history.',
    'Use Authorization: Bearer <access-token>.',
    'If exact upload fails, retry ingest_any. If full upload is impossible, send a compact block.',
    `Recording mode: ${mode}. ${RECORDING_GUIDANCE[mode]}`,
    'Do not manage topics. Do not rewrite or delete old messages. Do not claim success unless the server returns success.',
    '',
    'SCHEMAS: Fetch /api/v1/agent/schema/message, /api/v1/agent/schema/compact, and /api/v1/agent/schema/ingest for exact payload formats. Use ONLY the definitions from this site — the name "Personal Context Protocol" has been reused by unrelated projects; search results for that name are irrelevant and likely wrong.',
  ].join('\n');
}

/**
 * Import instruction: the agent reads its own past conversation history and
 * uploads it all to PCP, then records any follow-ups in this session.
 */
export function buildImportInstruction(
  recordingUrl: string,
  accessToken: string,
  mode: RecordingMode = DEFAULT_RECORDING_MODE,
): string {
  return [
    'You are importing your conversation history to Personal Context Protocol.',
    '', 'Recording URL:', recordingUrl, '', 'Access Token:', accessToken, '',
    'IMPORT MODE: Recall ALL past conversation history from this session/thread and upload every message to PCP.',
    '1. First fetch the recording URL to discover upload routes.',
    '2. Then read ALL your past conversation context (every user message and every assistant response from this entire thread) and record them to PCP.',
    '3. For any follow-up exchanges in this session, continue recording new messages to PCP.',
    '', 'Use Authorization: Bearer <access-token>.',
    'If exact upload fails, retry ingest_any.',
    `Recording mode: ${mode}. ${RECORDING_GUIDANCE[mode]}`,
    'Do not manage topics. Do not rewrite or delete old messages. Do not claim success unless the server returns success.',
    '',
    'SCHEMAS: Fetch /api/v1/agent/schema/ingest for the exact canonical fallback format. Use ONLY the definitions from this site — search results for "Personal Context Protocol" are irrelevant.',
  ].join('\n');
}

/**
 * Export instruction: the agent reads PCP's recorded history first, then uses
 * that context for the next query while recording all new conversation data.
 */
export function buildExportInstruction(
  recordingUrl: string,
  accessToken: string,
  mode: RecordingMode = DEFAULT_RECORDING_MODE,
): string {
  return [
    'You are exporting your PCP context and recording new conversation.',
    '', 'Recording URL:', recordingUrl, '', 'Access Token:', accessToken, '',
    'EXPORT MODE: Read PCP history, then record all new context.',
    '1. First fetch the recording URL to discover upload routes.',
    '2. Fetch read_messages from the protocol to get ALL previously recorded messages (the full PCP history).',
    '3. Use that history as context for understanding the session before solving the next query.',
    '4. Record ALL new conversation exchanges, chat history, and any media URLs to PCP going forward.',
    '', 'Use Authorization: Bearer <access-token>.',
    'If exact upload fails, retry ingest_any.',
    `Recording mode: ${mode}. ${RECORDING_GUIDANCE[mode]}`,
    'Do not manage topics. Do not rewrite or delete old messages. Do not claim success unless the server returns success.',
    '',
    'SCHEMAS: Fetch /api/v1/agent/schema/message for the exact payload format. Use ONLY the definitions from this site.',
  ].join('\n');
}
