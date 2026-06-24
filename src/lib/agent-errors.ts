/**
 * Structured errors for agent-facing routes.
 *
 * Every agent route returns the same envelope so an AI client can branch on
 * `code` and `retryable` instead of scraping prose:
 *
 *   { ok: false, code, retryable, message, next_steps: [...] }
 *
 * Messages still follow the project diagnostic rule (consequence + module /
 * process + cause); `next_steps` tells the agent what to do next. Kept pure
 * (no NextResponse import) so it can be unit-tested directly.
 */

export interface AgentErrorBody {
  ok: false;
  code: string;
  retryable: boolean;
  message: string;
  next_steps: string[];
}

export interface AgentErrorShape {
  status: number;
  retryable: boolean;
  message: string;
  next_steps: string[];
}

/**
 * Canonical agent error definitions. The map keeps wording stable and greppable
 * across call sites instead of ad-hoc strings per route.
 */
export const AGENT_ERRORS: Record<string, AgentErrorShape> = {
  UNAUTHORIZED: {
    status: 401,
    retryable: false,
    message: 'Unable to authenticate: agent session recording / bearer token check — missing or invalid access token.',
    next_steps: ['Send Authorization: Bearer <access-token> using the access token from the recording pair.'],
  },
  TOKEN_REVOKED: {
    status: 401,
    retryable: false,
    message: 'Unable to record: agent session recording / token revocation check — the access token was revoked.',
    next_steps: ['Ask the user to generate a new access token from the session detail page.'],
  },
  TOKEN_EXPIRED: {
    status: 401,
    retryable: false,
    message: 'Unable to record: agent session recording / token expiration check — the access token expired.',
    next_steps: ['Ask the user to generate a new access token from the session detail page.'],
  },
  SESSION_MISMATCH: {
    status: 403,
    retryable: false,
    message: 'Unable to record: agent session recording / session scope check — the access token is scoped to a different session.',
    next_steps: ['Use the recording URL the token was issued for, or ask the user for the matching token.'],
  },
  FORBIDDEN: {
    status: 403,
    retryable: false,
    message: 'Unable to perform action: agent session recording / permission check — the access token does not allow this action.',
    next_steps: ['Record messages only. Ask the user to enable the needed capability when generating the token.'],
  },
  NOT_FOUND: {
    status: 404,
    retryable: false,
    message: 'Unable to record: agent session recording / session lookup — the session does not exist.',
    next_steps: ['Confirm the recording URL with the user; the session may have been deleted.'],
  },
  SESSION_ARCHIVED: {
    status: 403,
    retryable: false,
    message: 'Unable to record: agent session recording / session state check — the session is archived and is read-only.',
    next_steps: ['Ask the user to restore the session before recording more messages.'],
  },
  UNPARSEABLE_PAYLOAD: {
    status: 422,
    retryable: true,
    message: 'Unable to ingest: agent session recording / payload parsing — the body did not match any supported format.',
    next_steps: [
      'Send { "messages": [ { "role": "user|assistant|system|tool|correction", "content": "..." } ] }.',
      'Or wrap a summary in <PCP_COMPACT>{ "summary": "..." }</PCP_COMPACT>.',
      'Or POST raw transcript text and the server will best-effort parse it.',
    ],
  },
  VALIDATION_ERROR: {
    status: 400,
    retryable: false,
    message: 'Unable to record: agent session recording / request validation — the request body failed validation.',
    next_steps: ['Fetch the protocol endpoint to re-read limits, then resend within max_messages_per_request and max_content_chars.'],
  },
  INTERNAL_ERROR: {
    status: 500,
    retryable: true,
    message: 'Unable to record: agent session recording / request handling — an internal error occurred.',
    next_steps: ['Retry after a short delay. If it persists, ask the user to check the deployment logs.'],
  },
};

/**
 * Build the structured error envelope for a known code, optionally overriding
 * the message or next steps with route-specific detail.
 */
export function agentErrorBody(
  code: string,
  overrides: { message?: string; next_steps?: string[]; retryable?: boolean } = {},
): { status: number; body: AgentErrorBody } {
  const def = AGENT_ERRORS[code] || AGENT_ERRORS.INTERNAL_ERROR;
  const resolvedCode = AGENT_ERRORS[code] ? code : 'INTERNAL_ERROR';
  return {
    status: def.status,
    body: {
      ok: false,
      code: resolvedCode,
      retryable: overrides.retryable ?? def.retryable,
      message: overrides.message ?? def.message,
      next_steps: overrides.next_steps ?? def.next_steps,
    },
  };
}

type AuthFailure = { error?: string; code?: string; status?: number };

/**
 * Map a `verifySessionToken` failure (used by admin routes) into the agent
 * error envelope so agent routes can reuse the same token validation logic
 * while returning the agent-shaped response. The parameter is intentionally
 * loose so the middleware's discriminated-union result can be passed directly.
 */
export function mapAuthFailure(authResult: AuthFailure): { status: number; body: AgentErrorBody } {
  const code = authResult.code && authResult.code in AGENT_ERRORS ? authResult.code : 'UNAUTHORIZED';
  return agentErrorBody(code, { message: authResult.error });
}
