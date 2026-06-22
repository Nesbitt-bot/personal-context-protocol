import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { appInstance } from '@/lib/schema';
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
    // Database not initialized or connection error
    return NextResponse.json({
      initialized: false,
      needs_migration: true,
    });
  }
}
