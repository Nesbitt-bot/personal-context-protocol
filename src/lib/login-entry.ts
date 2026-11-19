import { sanitizeReturnTo } from './return-to';

/** Callback failures stay visible until the user explicitly retries. */
export function loginDestination(input: {
  next: string | null; signedIn: boolean; oidc: boolean; authError: string | null; manualAdmin: boolean;
}): string | null {
  const next = sanitizeReturnTo(input.next);
  if (input.authError !== null) return null;
  if (input.signedIn) return next;
  if (input.oidc && !input.manualAdmin) return `/auth/login?next=${encodeURIComponent(next)}`;
  return null;
}
