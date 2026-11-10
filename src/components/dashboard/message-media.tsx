'use client';
import { useEffect, useState } from 'react';
import { uiAuthHeaders } from '@/lib/client-auth';

export type Attachment = { id: string; messageId: string; filename: string; sizeBytes: number; mimeType: string };
export function MessageMedia({ items }: { items: Attachment[] }) {
  const [images, setImages] = useState<Array<{ item: Attachment; url: string }>>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    const controller = new AbortController();
    setError(''); setImages([]);
    Promise.all(items.map(async item => {
      const response = await fetch(`/api/v1/attachments/${encodeURIComponent(item.id)}/content`, { headers: uiAuthHeaders(), signal: controller.signal });
      if (!response.ok) throw new Error(`Image unavailable: media/download - HTTP ${response.status}`);
      const url = URL.createObjectURL(await response.blob()); urls.push(url);
      if (!active) URL.revokeObjectURL(url);
      return { item, url };
    })).then(result => { if (active) setImages(result); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; controller.abort(); urls.forEach(url => URL.revokeObjectURL(url)); };
  }, [items]);
  return <div className="mt-2 flex flex-wrap gap-2">{images.map(({ item, url }) => item.mimeType.startsWith('audio/') ? <div key={item.id}><p className="text-xs">Voice message</p><audio controls preload="metadata" src={url} aria-label={item.filename} className="max-w-full" /></div> : item.mimeType.startsWith('video/') ? <video key={item.id} controls preload="metadata" src={url} aria-label={item.filename} className="max-h-64 max-w-full rounded-lg" /> : <a key={item.id} href={url} target="_blank" rel="noreferrer" title={item.filename}>
    <img src={url} alt={item.filename} loading="lazy" className="max-h-64 max-w-full rounded-lg" />
  </a>)}{error && <p role="alert">{error}</p>}</div>;
}
