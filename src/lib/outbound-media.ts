import crypto from 'crypto';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import { z } from 'zod';
import { MediaError, normalizeMedia, StoredMedia } from './media';

export const outboundMediaSchema = z.object({
  name: z.string().max(128), mime_type: z.string().max(100),
  data: z.string().min(4).max(8 * 1024 * 1024).regex(/^[A-Za-z0-9+/]+={0,2}$/),
}).strict();
export type OutboundMediaInput = z.infer<typeof outboundMediaSchema>;
export type DeliveryMedia = { name: string; mime_type: string; data: string; sha256: string };
const hash = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');
const allowed = new Set(['audio/wav', 'audio/mpeg', 'audio/ogg', 'audio/flac', 'audio/mp4', 'audio/aac', 'video/mp4', 'video/webm']);

/** PCP validates and records the exact bytes subsequently handed to AstrBot. */
export async function normalizeOutbound(inputs: OutboundMediaInput[]): Promise<{ stored: StoredMedia[]; delivery: DeliveryMedia[] }> {
  const stored: StoredMedia[] = [], delivery: DeliveryMedia[] = [];
  let inputSize = 0, outputSize = 0;
  for (const [index, item] of inputs.entries()) {
    const bytes = Buffer.from(item.data, 'base64'); inputSize += bytes.length;
    if (bytes.toString('base64') !== item.data || inputSize > 6 * 1024 * 1024 || index >= 4) throw new MediaError(413, 'MEDIA_LIMIT', 'reply media exceeds four files or six MiB');
    let type;
    try { type = await fileTypeFromBuffer(bytes); } catch { type = undefined; }
    if (!type || type.mime !== item.mime_type) throw new MediaError(415, 'MEDIA_TYPE', 'reply attachment MIME does not match its bytes');
    let output: Buffer = bytes; let mime: string = type.mime, extension: string = type.ext;
    if (mime.startsWith('image/')) {
      const [image] = await normalizeMedia([{ name: item.name, data: item.data }]);
      const webp = Buffer.from(image.dataUrl.split(',')[1], 'base64');
      const meta = await sharp(webp, { animated: true }).metadata();
      if ((meta.pages || 1) > 1) { output = await sharp(webp, { animated: true }).gif().toBuffer(); mime = 'image/gif'; extension = 'gif'; }
      else if (meta.hasAlpha) { output = await sharp(webp).png().toBuffer(); mime = 'image/png'; extension = 'png'; }
      else { output = await sharp(webp).jpeg({ quality: 90 }).toBuffer(); mime = 'image/jpeg'; extension = 'jpg'; }
    } else if (!allowed.has(mime)) throw new MediaError(415, 'MEDIA_TYPE', 'reply attachment is not a supported image, audio or video');
    outputSize += output.length;
    if (outputSize > 6 * 1024 * 1024) throw new MediaError(413, 'MEDIA_LIMIT', 'normalized reply media exceeds six MiB');
    const name = (item.name.replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 96) || `attachment-${index + 1}`) + '.' + extension;
    const digest = hash(output), data = output.toString('base64');
    stored.push({ hash: digest, uploadHash: hash(bytes), size: output.length, mime, name, dataUrl: `data:${mime};base64,${data}` });
    delivery.push({ name, mime_type: mime, data, sha256: digest });
  }
  return { stored, delivery };
}
