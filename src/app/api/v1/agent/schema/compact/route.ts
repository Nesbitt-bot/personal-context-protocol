import { NextResponse } from 'next/server';
import { MAX_CONTENT_CHARS } from '@/lib/agent-protocol';

export const dynamic = 'force-dynamic';

/** Public JSON schema for the compact payload. */
export async function GET() {
  return NextResponse.json({
    title: 'PCP Compact Schema',
    description: 'POST this to record_compact when full message upload is impossible. This is a durable session summary stored alongside raw messages; it never replaces them. Use ONLY this schema — do not search for other PCP projects.',
    project: 'personal-context-protocol',
    domain: 'Use ONLY the definitions on this site, not any other project named "personal-context-protocol" found via search.',
    schema: {
      type: 'object',
      required: ['summary'],
      properties: {
        summary: { type: 'string', minLength: 1, maxLength: MAX_CONTENT_CHARS, description: 'Required summary of the conversation' },
        timeline: { description: 'Optional chronological timeline of events' },
        decisions: { type: 'array', items: { type: 'string' }, description: 'Key decisions made' },
        requirements: { type: 'array', items: { type: 'string' }, description: 'Requirements captured' },
        open_questions: { type: 'array', items: { type: 'string' }, description: 'Unresolved questions' },
        artifacts: { type: 'array', items: { type: 'string' }, description: 'Notable artifacts' },
        warnings: { type: 'array', items: { type: 'string' }, description: 'Warnings or caveats' },
        provider: { type: 'string', maxLength: 100 },
        base_model: { type: 'string', maxLength: 100 },
        metadata: { type: 'object' },
      },
    },
    example: {
      summary: 'Discussed odometer readings for Carvana sale. Recommended entering current exact reading and disclosing small mileage increase at pickup.',
      decisions: ['Enter current dashboard reading now'],
      open_questions: ['Pickup date?', 'Final mileage disclosure form?'],
    },
    endpoint: '/api/v1/agent/sessions/{session_id}/compact',
    auth: 'Authorization: Bearer <access-token>',
  });
}
