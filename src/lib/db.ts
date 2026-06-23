import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

type Database = ReturnType<typeof drizzle<typeof schema>>;

function unavailableDatabase(cause: string): Database {
  return new Proxy({}, {
    get() {
      throw new Error(`Database is unavailable: database configuration / connection initialization - ${cause}`);
    },
  }) as Database;
}

function createDatabase(): Database {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    return unavailableDatabase('DATABASE_URL is not configured');
  }

  try {
    const queryClient = postgres(databaseUrl, { connect_timeout: 5 });
    return drizzle(queryClient, { schema });
  } catch (error) {
    const cause = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown connection initialization error';
    return unavailableDatabase(cause);
  }
}

export const db = createDatabase();
