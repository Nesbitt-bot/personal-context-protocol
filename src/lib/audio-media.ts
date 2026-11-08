/** Canonical mono 16 kHz PCM WAV; the adapter normalizes voice with ffmpeg. */
export function canonicalVoice(bytes: Buffer): Buffer {
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error('voice must be a PCM WAV file');
  if (bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error('WAV container length does not match its bytes');
  let format: Buffer | null = null, audio: Buffer | null = null;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const type = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4);
    const end = offset + 8 + size;
    if (end > bytes.length) throw new Error('WAV chunk exceeds the container');
    if (type === 'fmt ') { if (format) throw new Error('duplicate WAV format'); format = bytes.subarray(offset + 8, end); }
    if (type === 'data') { if (audio) throw new Error('duplicate WAV audio'); audio = bytes.subarray(offset + 8, end); }
    offset = end + (size % 2);
  }
  if (!format || format.length < 16 || !audio || !audio.length || audio.length % 2) throw new Error('WAV needs a valid format and audio payload');
  if (format.readUInt16LE(0) !== 1 || format.readUInt16LE(2) !== 1 || format.readUInt32LE(4) !== 16000
    || format.readUInt32LE(8) !== 32000 || format.readUInt16LE(12) !== 2 || format.readUInt16LE(14) !== 16) throw new Error('voice must be mono 16 kHz 16-bit PCM');
  if (audio.length > 180 * 32000) throw new Error('voice exceeds three minutes');
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + audio.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(audio.length, 40);
  return Buffer.concat([header, audio]);
}
