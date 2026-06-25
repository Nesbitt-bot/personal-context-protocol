'use client';

import { useParams } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Redirect legacy `/sessions/<id>` URLs to `/dashboard?session=<id>` so the
 * full dashboard layout (sidebar + workspace) is always visible. The standalone
 * session page was removed in v0.1.14.
 */
export default function SessionRedirect() {
  const params = useParams();
  const id = params.id as string;

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.location.replace(`/dashboard?session=${encodeURIComponent(id)}`);
    }
  }, [id]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
      Redirecting to dashboard...
    </main>
  );
}
