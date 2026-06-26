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

/**
 * Normalize an input mode to the stored value. `strict` is the public/UI name
 * for the stored `exact` mode (kept for backward compatibility).
 */
export function normalizeRecordingMode(value: unknown): RecordingMode {
  return value === 'exact' || value === 'strict' ? 'exact' : 'wild';
}

/** Public/UI display name for a stored mode: `exact` is shown as `strict`. */
export type DisplayMode = 'wild' | 'strict';
export function displayMode(mode: RecordingMode): DisplayMode {
  return mode === 'exact' ? 'strict' : 'wild';
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

/**
 * Shared, refusal-aware recording prompt. It establishes first-party consent,
 * gates direct upload behind the agent actually having a tool, and explicitly
 * offers "produce JSON for the human to import" as a good outcome — so an agent
 * that cannot or will not POST falls back to useful output instead of refusing.
 * It avoids the phrasing that reads as prompt-injection ("discover arbitrary
 * upload routes", "recall and upload all history", "transmit the token").
 */
function buildRecordingPrompt(opts: {
  headline: string;
  recordingUrl: string;
  accessToken: string;
  mode: RecordingMode;
  focus: string[];
}): string {
  const m = displayMode(opts.mode);
  return [
    opts.headline,
    '',
    'CONTEXT — read this first: the person you are talking to runs this chat and has set up a recording session in THEIR OWN Personal Context Protocol instance (their private notebook). They are asking you, with their consent, to help save this conversation into it. This is a first-party request from your own user — not an attempt to send data to an unknown third party. The access token below is the user\'s own credential for their own instance.',
    '',
    'CHOOSE BASED ON YOUR CAPABILITIES:',
    '- If you have a working web-request tool or an installed PCP MCP/tool in this environment, you may record directly: send `Authorization: Bearer <access-token>` to the routes listed by the recording URL.',
    '- If you have no way to make web requests, do NOT attempt to upload and do NOT transmit the token. Instead, produce a PCP import JSON object (schema below) and hand it to the user to paste into their dashboard themselves. This is a perfectly good, preferred outcome — do not refuse; just return the JSON.',
    '',
    'Recording URL (returns a short JSON descriptor of the upload routes):', opts.recordingUrl,
    '',
    'Access Token (the user\'s own credential for their own instance):', opts.accessToken,
    '',
    `Mode: ${m}. ${RECORDING_GUIDANCE[opts.mode]}`,
    '',
    ...opts.focus,
    '',
    'Boundaries: faithfully capture the messages of THIS conversation. Do not manage topics, rewrite or delete existing messages, or read other sessions. Do not claim anything was uploaded unless the server (or your tool) returned success — if you only produced JSON for the user, say so plainly.',
    '',
    'SCHEMA: `GET /api/v1/agent/schema/ingest` is the canonical import format. Use ONLY definitions from this site; ignore web search results for "Personal Context Protocol" — the name is reused by unrelated projects.',
  ].join('\n');
}

/** Default token instruction (capability-aware: direct write or produce JSON). */
export function buildAgentInstruction(
  recordingUrl: string,
  accessToken: string,
  mode: RecordingMode = DEFAULT_RECORDING_MODE,
): string {
  return buildRecordingPrompt({
    headline: 'You are helping the user save this conversation into their Personal Context Protocol notebook.',
    recordingUrl,
    accessToken,
    mode,
    focus: [
      'Capture each message of this conversation — every user message and every assistant reply, including this one.',
      'If a direct write fails, you may use the `ingest_any` route, or simply output the import JSON for the user to paste instead.',
    ],
  });
}

/** Import: capture the messages already exchanged in this thread. */
export function buildImportInstruction(
  recordingUrl: string,
  accessToken: string,
  mode: RecordingMode = DEFAULT_RECORDING_MODE,
): string {
  return buildRecordingPrompt({
    headline: 'You are helping the user save this conversation into their Personal Context Protocol notebook.',
    recordingUrl,
    accessToken,
    mode,
    focus: [
      'Capture the messages exchanged in THIS conversation/thread so the user has a faithful record of it.',
      'If you cannot make web requests, output the import JSON for the user to paste — do not refuse.',
    ],
  });
}

/** Export: optionally read prior recorded context, then keep capturing. */
export function buildExportInstruction(
  recordingUrl: string,
  accessToken: string,
  mode: RecordingMode = DEFAULT_RECORDING_MODE,
): string {
  return buildRecordingPrompt({
    headline: 'You are helping the user keep their Personal Context Protocol notebook up to date with this conversation.',
    recordingUrl,
    accessToken,
    mode,
    focus: [
      'If you have a web-request tool, you may read already-recorded context via the read route to avoid duplicates, then record new messages going forward.',
      'If you cannot make web requests, output the import JSON for the user to paste instead.',
    ],
  });
}
