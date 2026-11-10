import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { normalizeOutbound } from '../src/lib/outbound-media';
import crypto from 'crypto';

describe('outbound multimedia recording and bridge bytes', () => {
  it('normalizes JPEG and returns exactly the bytes stored, without EXIF or local paths', async () => {
    const original = await sharp({ create: { width: 20, height: 12, channels: 3, background: '#11aa33' } }).withExif({ IFD0: { Artist: 'private' } }).jpeg().toBuffer();
    const result = await normalizeOutbound([{ name: 'avatar.jpg', mime_type: 'image/jpeg', data: original.toString('base64') }]);
    const bytes = Buffer.from(result.delivery[0].data, 'base64');
    expect(result.stored[0].hash).toBe(crypto.createHash('sha256').update(bytes).digest('hex'));
    expect(result.delivery[0].mime_type).toBe('image/jpeg');
    expect((await sharp(bytes).metadata()).exif).toBeUndefined();
  });
  it('rejects forged MIME types and files outside the multimedia contract', async () => {
    await expect(normalizeOutbound([{ name: 'password.jpg', mime_type: 'image/jpeg', data: Buffer.from('secret text').toString('base64') }])).rejects.toMatchObject({ status: 415 });
    const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#ffffff' } }).png().toBuffer();
    await expect(normalizeOutbound([{ name: 'x.mp4', mime_type: 'video/mp4', data: png.toString('base64') }])).rejects.toMatchObject({ status: 415 });
  });
});
