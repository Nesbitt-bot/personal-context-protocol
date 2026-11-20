'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SiteNav } from '@/components/site-nav';
import { Avatar } from '@/components/account-menu';
import { fetchSignedInUser, SignedInUser } from '@/lib/client-auth';

export default function Profile() {
  const router = useRouter();
  const [user, setUser] = useState<SignedInUser | null>(null);
  useEffect(() => { fetchSignedInUser().then(u => u ? setUser(u) : router.replace('/login?next=/profile')); }, [router]);
  return <main><SiteNav /><section className="mx-auto max-w-3xl space-y-3 p-6"><h1 className="text-xl font-semibold">Profile</h1>
    {user && <><Avatar user={user} /><p>{user.display_name}</p><p>{user.is_admin ? 'Administrator' : 'Member'} · {user.method === 'oidc' ? 'Casdoor' : 'Break-glass login'}</p></>}
  </section></main>;
}
