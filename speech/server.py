"""Local OpenAI-compatible voice transcription; no transcript logging."""
from __future__ import annotations
import asyncio
import hmac
import logging
import os
from pathlib import Path
import tempfile
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from faster_whisper import WhisperModel

LOG = logging.getLogger('pcp-speech')
app = FastAPI()
model = None
lock = asyncio.Lock()


def transcribe(path):
    global model
    if model is None:
        LOG.warning('Loading speech model: PCP/speech startup - first request downloads the configured model into persistent storage')
        model = WhisperModel(os.environ.get('WHISPER_MODEL', 'base'), device='cpu', compute_type='int8', cpu_threads=4,
                             download_root='/models')
    segments, info = model.transcribe(path, beam_size=3, vad_filter=True)
    if info.duration > 180:
        raise ValueError('Voice exceeds three minutes')
    return ''.join(segment.text for segment in segments).strip()


@app.get('/healthz')
def health():
    return {'status': 'ok', 'model_loaded': model is not None}


@app.post('/v1/audio/transcriptions')
async def audio(file: UploadFile = File(...), model_name: str = Form('whisper-1', alias='model'), authorization: str | None = Header(None)):
    key = os.environ.get('SPEECH_API_KEY', '')
    if not key or not hmac.compare_digest(authorization or '', 'Bearer ' + key):
        raise HTTPException(401, 'Transcription refused: PCP/speech authentication - invalid credential')
    if lock.locked():
        raise HTTPException(429, 'Transcription deferred: PCP/speech queue - another voice request is running')
    size = 0
    with tempfile.NamedTemporaryFile(suffix='.audio') as target:
        while block := await file.read(65536):
            size += len(block)
            if size > 6 * 1024 * 1024:
                raise HTTPException(413, 'Transcription refused: PCP/speech size - audio exceeds six MiB')
            target.write(block)
        target.flush()
        async with lock:
            try:
                text = await asyncio.to_thread(transcribe, target.name)
            except Exception as error:
                LOG.error('Transcription unavailable: PCP/speech inference - %s', type(error).__name__)
                raise HTTPException(422, 'Transcription unavailable: PCP/speech inference - unsupported audio or model unavailable') from None
    return {'text': text}
