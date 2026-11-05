import { NextResponse } from 'next/server';
import { breakGlassEnabled, oidcDisabledMessage, readOidcConfig } from '@/lib/oidc-config';

export const dynamic = 'force-dynamic';

/** Public, secret-free login configuration for the login page. */
export async function GET() {
  const oidc = readOidcConfig();
  return NextResponse.json({
    oidc_enabled: oidc.enabled,
    oidc_error: oidc.enabled ? null : oidcDisabledMessage(oidc.problems),
    break_glass_enabled: breakGlassEnabled(),
  });
}
