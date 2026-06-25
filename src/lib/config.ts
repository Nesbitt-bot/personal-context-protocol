/**
 * Shared runtime configuration validation. Checks the required deployment
 * variables for both *missing* and *malformed* values, and returns structured,
 * secret-free issues so the setup UI and diagnostics can surface them without
 * ever echoing a value. Pure (takes the env in) so it is unit-testable.
 */

export type ConfigSeverity = 'error' | 'warning';

export interface ConfigIssue {
  key: string;
  severity: ConfigSeverity;
  problem: string;
}

export interface ConfigEnv {
  DATABASE_URL?: string;
  PCP_INSTANCE_SECRET?: string;
  PCP_APP_URL?: string;
  [key: string]: string | undefined;
}

const MIN_SECRET_LENGTH = 32;

/**
 * Validate the deployment configuration. Errors block correct operation;
 * warnings are advisory (e.g. an unset `PCP_APP_URL`, where the request origin
 * is used instead). Values are never included in the returned issues.
 */
export function validateRuntimeConfig(env: ConfigEnv): { ok: boolean; issues: ConfigIssue[] } {
  const issues: ConfigIssue[] = [];

  const databaseUrl = (env.DATABASE_URL || '').trim();
  if (!databaseUrl) {
    issues.push({ key: 'DATABASE_URL', severity: 'error', problem: 'is not set' });
  } else if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
    issues.push({ key: 'DATABASE_URL', severity: 'error', problem: 'must be a postgres:// or postgresql:// connection string' });
  }

  const secret = (env.PCP_INSTANCE_SECRET || '').trim();
  if (!secret) {
    issues.push({ key: 'PCP_INSTANCE_SECRET', severity: 'error', problem: 'is not set' });
  } else if (secret.length < MIN_SECRET_LENGTH) {
    issues.push({ key: 'PCP_INSTANCE_SECRET', severity: 'error', problem: `must be at least ${MIN_SECRET_LENGTH} characters` });
  }

  const appUrl = (env.PCP_APP_URL || '').trim();
  if (!appUrl) {
    issues.push({ key: 'PCP_APP_URL', severity: 'warning', problem: 'is not set; the request origin is used to build recording URLs' });
  } else if (!isAbsoluteHttpUrl(appUrl)) {
    issues.push({ key: 'PCP_APP_URL', severity: 'error', problem: 'must be an absolute http(s) URL (an unexpanded template like ${VERCEL_URL} is ignored)' });
  }

  return { ok: issues.every((issue) => issue.severity !== 'error'), issues };
}

function isAbsoluteHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
