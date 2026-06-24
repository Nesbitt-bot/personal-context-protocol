import { describe, it, expect, afterEach } from 'vitest';
import { buildRecordingUrl, parseRecordingUrl, resolveAppBaseUrl } from '../src/lib/recording-url';
import { buildAgentInstruction, buildAgentProtocol } from '../src/lib/agent-protocol';
import { parseIngestPayload } from '../src/lib/ingest';
import { resolveExpiresAt, tokenStatus, isExpirationChoice } from '../src/lib/token-expiration';
import { agentErrorBody, mapAuthFailure } from '../src/lib/agent-errors';

describe('recording URL', () => {
  it('builds a recording URL from a base and session id', () => {
    expect(buildRecordingUrl('https://pcp.example.com', 'ses_123')).toBe('https://pcp.example.com/r/ses_123');
  });

  it('trims trailing slashes on the base', () => {
    expect(buildRecordingUrl('https://pcp.example.com/', 'ses_123')).toBe('https://pcp.example.com/r/ses_123');
  });

  it('parses a session id back out of a recording URL', () => {
    expect(parseRecordingUrl('https://pcp.example.com/r/ses_123')).toEqual({ sessionId: 'ses_123' });
  });

  it('parses a bare /r/<id> path', () => {
    expect(parseRecordingUrl('/r/ses_abc')).toEqual({ sessionId: 'ses_abc' });
  });

  it('returns null for non-recording URLs', () => {
    expect(parseRecordingUrl('https://pcp.example.com/dashboard')).toBeNull();
    expect(parseRecordingUrl('')).toBeNull();
    expect(parseRecordingUrl(null)).toBeNull();
  });

  it('round-trips build then parse', () => {
    const url = buildRecordingUrl(resolveAppBaseUrl('https://host.test'), 'ses_round');
    expect(parseRecordingUrl(url)).toEqual({ sessionId: 'ses_round' });
  });

  describe('resolveAppBaseUrl hardening', () => {
    const original = process.env.PCP_APP_URL;
    afterEach(() => {
      if (original === undefined) delete process.env.PCP_APP_URL;
      else process.env.PCP_APP_URL = original;
    });

    it('uses a valid PCP_APP_URL', () => {
      process.env.PCP_APP_URL = 'https://pcp.example.com/';
      expect(resolveAppBaseUrl('https://origin.test')).toBe('https://pcp.example.com');
    });

    it('falls back to the request origin when PCP_APP_URL is an unexpanded template', () => {
      process.env.PCP_APP_URL = '${VERCEL_URL}';
      expect(resolveAppBaseUrl('https://origin.test')).toBe('https://origin.test');
    });

    it('falls back to the request origin when PCP_APP_URL is not absolute', () => {
      process.env.PCP_APP_URL = 'pcp.example.com';
      expect(resolveAppBaseUrl('https://origin.test')).toBe('https://origin.test');
    });
  });
});

describe('agent protocol', () => {
  const protocol = buildAgentProtocol('ses_1');

  it('advertises the upload routes for the session', () => {
    expect(protocol.routes.record_messages).toBe('/api/v1/agent/sessions/ses_1/messages');
    expect(protocol.routes.record_compact).toBe('/api/v1/agent/sessions/ses_1/compact');
    expect(protocol.routes.ingest_any).toBe('/api/v1/agent/sessions/ses_1/ingest');
  });

  it('forbids topic management and message rewriting', () => {
    expect(protocol.allowed_actions.manage_topics).toBe(false);
    expect(protocol.allowed_actions.rewrite_messages).toBe(false);
    expect(protocol.allowed_actions.delete_messages).toBe(false);
  });

  it('uses bearer auth and publishes limits', () => {
    expect(protocol.auth.type).toBe('bearer');
    expect(protocol.limits.max_messages_per_request).toBeGreaterThan(0);
    expect(protocol.limits.max_content_chars).toBeGreaterThan(0);
  });

  it('builds an instruction that only requires URL + token', () => {
    const instruction = buildAgentInstruction('https://host/r/ses_1', 'tok_secret');
    expect(instruction).toContain('https://host/r/ses_1');
    expect(instruction).toContain('tok_secret');
    expect(instruction).toContain('Do not manage topics');
  });

  it('defaults to wild mode and exposes recording guidance', () => {
    expect(protocol.recording_mode).toBe('wild');
    expect(protocol.recording_guidance).toMatch(/redact/i);
  });

  it('exact mode tells the agent to record verbatim', () => {
    const exact = buildAgentProtocol('ses_1', { mode: 'exact' });
    expect(exact.recording_mode).toBe('exact');
    expect(exact.recording_guidance).toMatch(/verbatim/i);
    const instruction = buildAgentInstruction('https://host/r/ses_1', 'tok', 'exact');
    expect(instruction).toContain('Recording mode: exact');
  });
});

describe('token expiration', () => {
  const now = new Date('2026-06-23T00:00:00.000Z');

  it('resolves fixed durations to a future timestamp', () => {
    const expires = resolveExpiresAt('7d', now);
    expect(expires?.toISOString()).toBe('2026-06-30T00:00:00.000Z');
  });

  it('resolves "never" to null', () => {
    expect(resolveExpiresAt('never', now)).toBeNull();
  });

  it('validates expiration choices', () => {
    expect(isExpirationChoice('24h')).toBe(true);
    expect(isExpirationChoice('forever')).toBe(false);
  });

  it('reports active, expired and revoked status', () => {
    const future = new Date('2026-12-01T00:00:00.000Z');
    const past = new Date('2026-01-01T00:00:00.000Z');
    expect(tokenStatus({ revoked: false, expiresAt: future }, now)).toBe('active');
    expect(tokenStatus({ revoked: false, expiresAt: past }, now)).toBe('expired');
    expect(tokenStatus({ revoked: true, expiresAt: future }, now)).toBe('revoked');
  });

  it('treats a null expiry (legacy token) as never-expiring', () => {
    expect(tokenStatus({ revoked: false, expiresAt: null }, now)).toBe('active');
  });
});

describe('forgiving ingest', () => {
  it('accepts a { messages } object', () => {
    const result = parseIngestPayload(JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(result).toEqual({ kind: 'messages', messages: [{ role: 'user', content: 'hi' }] });
  });

  it('accepts a ChatML-like array and maps roles', () => {
    const result = parseIngestPayload(JSON.stringify([{ role: 'human', content: 'q' }, { role: 'ai', content: 'a' }]));
    expect(result).toEqual({
      kind: 'messages',
      messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }],
    });
  });

  it('accepts a <PCP_COMPACT> block', () => {
    const result = parseIngestPayload('<PCP_COMPACT>{"summary":"did stuff","decisions":["a"]}</PCP_COMPACT>');
    expect(result.kind).toBe('compact');
    if (result.kind === 'compact') {
      expect(result.compact.summary).toBe('did stuff');
      expect(result.compact.decisions).toEqual(['a']);
    }
  });

  it('accepts a <PCP_APPEND> block', () => {
    const result = parseIngestPayload('<PCP_APPEND>{"messages":[{"role":"assistant","content":"ok"}]}</PCP_APPEND>');
    expect(result).toEqual({ kind: 'messages', messages: [{ role: 'assistant', content: 'ok' }] });
  });

  it('falls back to parsing a raw transcript', () => {
    const result = parseIngestPayload('User: hello\nAssistant: hi there');
    expect(result).toEqual({
      kind: 'messages',
      messages: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi there' }],
    });
  });

  it('captures unstructured text as a single message', () => {
    const result = parseIngestPayload('just a freeform note');
    expect(result).toEqual({ kind: 'messages', messages: [{ role: 'user', content: 'just a freeform note' }] });
  });

  it('returns an error only for an empty body', () => {
    const result = parseIngestPayload('   ');
    expect(result.kind).toBe('error');
  });
});

describe('agent error envelope', () => {
  it('shapes a known error with retry guidance', () => {
    const { status, body } = agentErrorBody('TOKEN_EXPIRED');
    expect(status).toBe(401);
    expect(body).toMatchObject({ ok: false, code: 'TOKEN_EXPIRED', retryable: false });
    expect(body.next_steps.length).toBeGreaterThan(0);
  });

  it('marks unparseable payloads retryable', () => {
    const { status, body } = agentErrorBody('UNPARSEABLE_PAYLOAD');
    expect(status).toBe(422);
    expect(body.retryable).toBe(true);
  });

  it('falls back to INTERNAL_ERROR for unknown codes', () => {
    const { body } = agentErrorBody('SOMETHING_WEIRD');
    expect(body.code).toBe('INTERNAL_ERROR');
  });

  it('maps a middleware auth failure into the agent envelope', () => {
    const { status, body } = mapAuthFailure({ error: 'scope mismatch', code: 'SESSION_MISMATCH', status: 403 });
    expect(status).toBe(403);
    expect(body.code).toBe('SESSION_MISMATCH');
    expect(body.message).toBe('scope mismatch');
  });

  it('never embeds a token value in the envelope', () => {
    const { body } = agentErrorBody('UNAUTHORIZED');
    expect(JSON.stringify(body)).not.toMatch(/[a-f0-9]{32}/);
  });
});
