"""Preserve event-owned voice bytes after AstrBot replaces Record with STT text."""
from __future__ import annotations
import base64
import hashlib
from pathlib import Path
import subprocess
import tempfile

try:
    from .pcp_media import LOCAL_ROOT, MAX_BYTES, read_image
except ImportError:
    from pcp_media import LOCAL_ROOT, MAX_BYTES, read_image


def normalize_voice(data):
    if not data or len(data) > MAX_BYTES:
        raise ValueError('Voice unavailable: AstrBot/audio size - source exceeds six MiB')
    with tempfile.TemporaryDirectory(prefix='pcp-voice-') as folder:
        source, target = Path(folder) / 'input', Path(folder) / 'voice.wav'
        source.write_bytes(data)
        result = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe',
                                 '-threads', '1', '-i', str(source), '-vn', '-t', '181', '-map_metadata', '-1',
                                 '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-y', str(target)],
                                capture_output=True, timeout=30)
        if result.returncode or not target.is_file():
            raise ValueError('Voice unavailable: AstrBot/audio decode - unsupported or corrupt voice data')
        output = target.read_bytes()
        if len(output) > 180 * 32000 + 1024:
            raise ValueError('Voice unavailable: AstrBot/audio duration - voice exceeds three minutes')
        return output


def collect_audio(event, segments, used_bytes=0):
    sources = []
    for segment in segments:
        if type(segment).__name__.lower() in ('record', 'audio'):
            sources.append(getattr(segment, 'path', '') or getattr(segment, 'file', '') or getattr(segment, 'url', ''))
    # AstrBot 4.29's preprocessing owns these files until the event completes.
    # Successful STT replaces Record with Plain, but retains the normalized WAV.
    sources.extend(p for p in getattr(event, '_temporary_local_files', []) if str(p).lower().endswith('.wav'))
    media, notes, hashes = [], [], set()
    for source in dict.fromkeys(str(p) for p in sources if p):
        if len(media) >= 1:
            break
        try:
            audio = normalize_voice(read_image(source))
            digest = hashlib.sha256(audio).hexdigest()
            if digest in hashes:
                continue
            if used_bytes + len(audio) > MAX_BYTES:
                raise ValueError('Voice unavailable: AstrBot/audio size - combined media exceeds six MiB')
            hashes.add(digest)
            media.append({'kind': 'audio', 'name': 'voice.wav', 'data': base64.b64encode(audio).decode('ascii')})
        except (OSError, ValueError, subprocess.TimeoutExpired):
            notes.append('[voice attachment omitted: unavailable or exceeds media limits]')
    return media, notes
