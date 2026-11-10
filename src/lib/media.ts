import crypto from 'crypto';
import { canonicalVoice } from './audio-media';
import { promises as fs } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { z } from 'zod';

export const MEDIA_BODY_LIMIT = 12 * 1024 * 1024;
export const mediaInputSchema = z.object({
  kind: z.enum(['image', 'audio']).optional(),
  name: z.string().max(128),
  data: z.string().min(4).max(8 * 1024 * 1024).regex(/^[A-Za-z0-9+/]+={0,2}$/),
}).strict();
export type MediaInput = z.infer<typeof mediaInputSchema>;
export type StoredMedia = { hash: string; uploadHash: string; size: number; mime: string; name: string; dataUrl: string };
export class MediaError extends Error {
  constructor(public status: number, public code: string, cause: string) {
    super(`Unable to attach media: PCP/media validation - ${cause}`);
  }
}
export function blobRoot() {
  const root = process.env.PCP_BLOB_DIR;
  if (!root || !path.isAbsolute(root)) throw new MediaError(503, 'MEDIA_STORAGE_UNAVAILABLE', 'persistent blob directory is not configured');
  return root;
}
export function blobPath(hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new MediaError(400, 'INVALID_BLOB', 'invalid content hash');
  return path.join(blobRoot(), hash.slice(0, 2), hash);
}
const digest = (value: Buffer) => crypto.createHash('sha256').update(value).digest('hex');

/** Decode with pixel/frame bounds and re-encode without EXIF, GPS or profiles. */
export async function normalizeMedia(inputs: MediaInput[]): Promise<StoredMedia[]> {
  if (inputs.length > 4) throw new MediaError(413, 'MEDIA_LIMIT', 'at most four media attachments per turn');
  let total = 0, normalizedBytes = 0;
  const result: StoredMedia[] = [];
  for (const input of inputs) {
    const bytes = Buffer.from(input.data, 'base64');
    total += bytes.length;
    if (bytes.toString('base64') !== input.data || total > 6 * 1024 * 1024) throw new MediaError(413, 'MEDIA_LIMIT', 'invalid encoding or images exceed six MiB per turn');
    try {
      if (input.kind === 'audio') {
        const output = canonicalVoice(bytes);
        normalizedBytes += output.length;
        if (normalizedBytes > 6 * 1024 * 1024) throw new MediaError(413, 'MEDIA_LIMIT', 'combined media exceeds six MiB');
        result.push({ hash: digest(output), uploadHash: digest(bytes), size: output.length, mime: 'audio/wav', name: 'voice.wav', dataUrl: `data:audio/wav;base64,${output.toString('base64')}` });
        continue;
      }
      const options = { animated: true, limitInputPixels: 100_000_000, failOn: 'warning' as const };
      const meta = await sharp(bytes, options).metadata();
      if (!['jpeg', 'png', 'gif', 'webp', 'heif'].includes(meta.format || '')) throw new MediaError(415, 'MEDIA_TYPE', 'only JPEG, PNG, GIF, WebP and HEIF images are accepted');
      const width = meta.width || 0, height = meta.pageHeight || meta.height || 0, pages = meta.pages || 1;
      if (!width || !height || width > 8192 || height > 8192 || width * height > 40_000_000 || pages > 300 || width * height * pages > 100_000_000) {
        throw new MediaError(413, 'MEDIA_DIMENSIONS', 'image dimensions or animation frame budget exceeded');
      }
      const output = await sharp(bytes, options).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
      normalizedBytes += output.length;
      if (normalizedBytes > 6 * 1024 * 1024) throw new MediaError(413, 'MEDIA_LIMIT', 'normalized image exceeds six MiB');
      result.push({ hash: digest(output), uploadHash: digest(bytes), size: output.length, mime: 'image/webp',
        name: input.name.replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 120) || 'image', dataUrl: `data:image/webp;base64,${output.toString('base64')}` });
    } catch (error) {
      if (error instanceof MediaError) throw error;
      throw new MediaError(415, 'MEDIA_DECODE_FAILED', 'media is unsupported, corrupt or exceeds its decode budget');
    }
  }
  return result;
}

export async function persistMedia(media: StoredMedia) {
  const target = blobPath(media.hash);
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temp = `${target}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  const file = await fs.open(temp, 'wx', 0o600);
  try {
    await file.writeFile(Buffer.from(media.dataUrl.split(',')[1], 'base64'));
    await file.sync();
  } finally { await file.close(); }
  await fs.rename(temp, target);
}
