/**
 * OIDC (Casdoor) login configuration. Pure: takes the env in so it is unit
 * testable. Human login is fail-closed: if any required variable is missing
 * or malformed, OIDC login is disabled and the login page shows why. Values
 * are never echoed in the returned problems.
 */

export const OIDC_ENV_KEYS = [
  'PCP_OIDC_ISSUER',
  'PCP_OIDC_CLIENT_ID',
  'PCP_OIDC_CLIENT_SECRET',
  'PCP_OIDC_REDIRECT_URI',
  'PCP_OIDC_REQUIRED_GROUP',
  'PCP_OIDC_ADMIN_GROUP',
] as const;

/** Purpose-named opt-in for the legacy single admin-token UI login. */
export const BREAK_GLASS_ENV = 'PCP_BREAK_GLASS_ADMIN_LOGIN';

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  requiredGroup: string;
  adminGroup: string;
  /** Origin of the redirect URI; used to build absolute post-login redirects. */
  appOrigin: string;
}

export type OidcConfigResult =
  | { enabled: true; config: OidcConfig }
  | { enabled: false; problems: string[] };

type Env = Record<string, string | undefined>;

function isLoopbackHost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/** https everywhere, plain http only for loopback development. */
function parseSecureUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return url;
    if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return url;
    return null;
  } catch {
    return null;
  }
}

export function readOidcConfig(env: Env = process.env): OidcConfigResult {
  const problems: string[] = [];
  const value = (key: string) => (env[key] || '').trim();

  for (const key of OIDC_ENV_KEYS) {
    if (!value(key)) problems.push(`${key} is not set`);
  }

  const issuerRaw = value('PCP_OIDC_ISSUER');
  const issuerUrl = issuerRaw ? parseSecureUrl(issuerRaw) : null;
  if (issuerRaw && !issuerUrl) problems.push('PCP_OIDC_ISSUER must be an absolute https URL');

  const redirectRaw = value('PCP_OIDC_REDIRECT_URI');
  const redirectUrl = redirectRaw ? parseSecureUrl(redirectRaw) : null;
  if (redirectRaw && !redirectUrl) {
    problems.push('PCP_OIDC_REDIRECT_URI must be an absolute https URL');
  } else if (redirectUrl && redirectUrl.pathname !== '/auth/callback') {
    problems.push('PCP_OIDC_REDIRECT_URI must point at the /auth/callback path');
  }

  if (problems.length > 0 || !issuerUrl || !redirectUrl) {
    return { enabled: false, problems };
  }

  return {
    enabled: true,
    config: {
      // Compared exactly against discovery and the ID token `iss`, so keep the
      // configured spelling apart from a trailing slash.
      issuer: issuerRaw.replace(/\/+$/, ''),
      clientId: value('PCP_OIDC_CLIENT_ID'),
      clientSecret: value('PCP_OIDC_CLIENT_SECRET'),
      redirectUri: redirectUrl.toString(),
      requiredGroup: value('PCP_OIDC_REQUIRED_GROUP'),
      adminGroup: value('PCP_OIDC_ADMIN_GROUP'),
      appOrigin: redirectUrl.origin,
    },
  };
}

/** Break-glass admin-token login is enabled only by an explicit `1`/`true`. */
export function breakGlassEnabled(env: Env = process.env): boolean {
  const raw = (env[BREAK_GLASS_ENV] || '').trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

/** Human-readable message for the login page and API when OIDC is disabled. */
export function oidcDisabledMessage(problems: string[]): string {
  return `Unable to sign in: OIDC login configuration / environment validation - login is disabled because ${problems.join('; ')}. Set the PCP_OIDC_* variables in the deployment environment and redeploy.`;
}

/** Login page messages for each callback failure code (no secrets). */
export function loginErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    OIDC_DISABLED: 'Casdoor sign-in is not configured on this deployment',
    GROUP_REQUIRED: 'your Casdoor account is not in the group required to use PCP; ask the owner to add you',
    LOGIN_STATE_MISSING: 'the sign-in request was not found or was already used; start again',
    LOGIN_STATE_EXPIRED: 'the sign-in request expired; start again',
    LOGIN_STATE_MISMATCH: 'the sign-in response did not match this browser; start again',
    OIDC_PROVIDER_DENIED: 'Casdoor did not authorize the sign-in',
    OIDC_PROVIDER_UNREACHABLE: 'Casdoor could not be reached',
  };
  return messages[code] || 'the identity provider response could not be verified';
}
