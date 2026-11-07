import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { normalizeMedia } from '../src/lib/media';

describe('sanitized media', () => {
  it('decodes by content, strips metadata, and deduplicates normalized bytes', async () => {
    const data = (await sharp({ create: { width: 32, height: 20, channels: 3, background: '#e02010' } }).jpeg().withExif({ IFD0: { Artist: 'private-owner' } }).toBuffer()).toString('base64');
    const [a, b] = await normalizeMedia([{ name: '../photo.jpg', data }, { name: 'copy.jpg', data }]);
    expect(a.hash).toBe(b.hash);
    const meta = await sharp(Buffer.from(a.dataUrl.split(',')[1], 'base64')).metadata();
    expect(meta.format).toBe('webp'); expect(meta.exif).toBeUndefined(); expect(a.name).not.toContain('/');
  });
  it('rejects active content disguised as an image and excessive count', async () => {
    await expect(normalizeMedia([{ name: 'photo.jpg', data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>').toString('base64') }])).rejects.toMatchObject({ status: 415 });
    await expect(normalizeMedia(Array.from({ length: 5 }, () => ({ name: 'x', data: 'AAAA' })))).rejects.toMatchObject({ status: 413 });
  });
  it('preserves animated GIF frames within the decode budget', async () => {
    const data = 'R0lGODlhAwACAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAwACAAAIBgABCBwYEAAh+QQBCgABACwAAAAAAwACAIEAAP8AAAAAAAAAAAAIBgABCBwYEAA7';
    const [output] = await normalizeMedia([{ name: 'animation.gif', data }]);
    const meta = await sharp(Buffer.from(output.dataUrl.split(',')[1], 'base64'), { animated: true }).metadata();
    expect(meta.format).toBe('webp'); expect(meta.pages).toBe(2);
  });
});
