import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { appInstance } from '@/lib/schema';
import { logError } from '@/lib/logging';
import { sql } from 'drizzle-orm';

export async function GET() {
  try {
    // Check if app is initialized
    const [instance] = await db.select().from(appInstance);
    
    if (!instance) {
      return NextResponse.json({
        initialized: false,
        needs_migration: true,
      });
    }
    
    return NextResponse.json({
      initialized: true,
      version: instance.version,
      needs_migration: false,
    });
  } catch (error) {
    logError({
      consequence: 'Unable to check setup status',
      moduleProcess: 'app setup / initialization status database probe',
      cause: 'app_instance lookup failed because the database is unavailable or the schema is missing',
      error,
    });
    return NextResponse.json({
      initialized: false,
      needs_migration: true,
      error: 'Unable to check setup status: app setup / initialization status database probe - database unavailable or app_instance schema missing',
      code: 'SETUP_STATUS_PROBE_FAILED',
    });
  }
}
