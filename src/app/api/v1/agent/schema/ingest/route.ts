import { NextResponse } from 'next/server';
import { buildIngestSchemaDescriptor } from '@/lib/agent-schema';

export const dynamic = 'force-dynamic';

/**
 * Public canonical ingest schema. Returns the exact accepted fallback format,
 * wild/strict mode semantics, examples, and import limits — the single source of
 * truth shared with the generated copy-paste fallback prompts.
 */
export async function GET() {
  return NextResponse.json(buildIngestSchemaDescriptor());
}
