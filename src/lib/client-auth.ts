/**
 * Browser-side auth helpers. Casdoor sign-in uses HttpOnly cookies the browser
 * sends automatically; state-changing requests must also echo the CSRF token
 * from the readable `__Host-pcp_csrf` cookie. When the operator has enabled
 * break-glass admin-token login and it was used, the token kept in
 * localStorage is sent as a Bearer header instead.
 */

export const BREAK_GLASS_STORAGE_KEY = 'ui_token';
const CSRF_COOKIE = '__Host-pcp_csrf';

function readCookie(name: string): string {
  if (typeof document === 'undefined') return '';
  const prefix = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return decodeURIComponent(trimmed.slice(prefix.length));
  }
  return '';
}

export function breakGlassToken(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(BREAK_GLASS_STORAGE_KEY) || '';
}

/** Headers for any web UI API call (safe to spread into every request). */
export function uiAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = breakGlassToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const csrf = readCookie(CSRF_COOKIE);
  if (csrf) headers['X-PCP-CSRF'] = csrf;
  return headers;
}

export interface SignedInUser {
  user_id: string;
  display_name: string;
  is_admin: boolean;
  method: 'oidc' | 'break_glass';
}

/** Current user, or null when anonymous (401). */
export async function fetchSignedInUser(): Promise<SignedInUser | null> {
  try {
    const res = await fetch('/api/v1/auth/me', { headers: uiAuthHeaders(), cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as SignedInUser;
  } catch {
    return null;
  }
}

export async function signOut() {
  const headers = uiAuthHeaders();
  localStorage.removeItem(BREAK_GLASS_STORAGE_KEY);
  await fetch('/auth/logout', { method: 'POST', headers }).catch(() => undefined);
}
