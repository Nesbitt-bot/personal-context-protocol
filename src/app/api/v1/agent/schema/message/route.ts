import { NextResponse } from 'next/server';
import { MAX_CONTENT_CHARS, MAX_MESSAGES_PER_REQUEST } from '@/lib/agent-protocol';

export const dynamic = 'force-dynamic';

/**
 * Public JSON schema for the message append payload. Agents fetch this to
 * learn the exact shape without guessing or searching the web.
 */
export async function GET() {
  return NextResponse.json({
    title: 'PCP Message Append Schema',
    description: 'POST this to record_messages with Authorization: Bearer <access-token>. This is the ONLY schema for Personal Context Protocol message recording — do not search for other PCP projects.',
    project: 'personal-context-protocol',
    domain: 'Use ONLY the definitions on this site, not any other project named "personal-context-protocol" found via search.',
    schema: {
      type: 'object',
      required: ['messages'],
      properties: {
        messages: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_MESSAGES_PER_REQUEST,
          items: {
            type: 'object',
            required: ['role', 'content'],
            properties: {
              role: { type: 'string', enum: ['user', 'assistant', 'system', 'tool', 'correction'] },
              content: { type: 'string', minLength: 1, maxLength: MAX_CONTENT_CHARS },
              provider: { type: 'string', maxLength: 100, description: 'AI provider name: anthropic, openai, gemini, cursor, codex, unknown' },
              base_model: { type: 'string', maxLength: 100, description: 'Model name: claude, gpt, etc.' },
              provider_timestamp: { type: 'string', format: 'date-time' },
            },
          },
        },
        suggested_session_title: { type: 'string', maxLength: 200, description: 'Optional; requires a token with rename permission' },
      },
    },
    example: {
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi.', provider: 'anthropic', base_model: 'claude' },
      ],
    },
    endpoint: '/api/v1/agent/sessions/{session_id}/messages',
    auth: 'Authorization: Bearer <access-token>',
  });
}
