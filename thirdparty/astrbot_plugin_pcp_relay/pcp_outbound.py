"""Convert validated PCP attachments into AstrBot media, retaining send evidence."""
from __future__ import annotations
import asyncio
import base64
import hashlib
import json
import secrets
import urllib.request

from astrbot.api import logger
from astrbot.api.message_components import Image, Plain, Record, Video
from astrbot.core.message.message_event_result import MessageChain

try:
    from .pcp_relay_core import sign
except ImportError:
    from pcp_relay_core import sign

MAX_BYTES = 6 * 1024 * 1024


def reply_chain(text, media):
    if len(media) > 4:
        raise ValueError('Reply not sent: PCP relay/media validation — more than four attachments')
    chain = MessageChain()
    if text:
        chain.chain.append(Plain(text))
    total = 0
    for item in media:
        data = base64.b64decode(item['data'], validate=True)
        total += len(data)
        if total > MAX_BYTES or hashlib.sha256(data).hexdigest() != item.get('sha256'):
            raise ValueError('Reply not sent: PCP relay/media validation — invalid checksum or size limit exceeded')
        mime = item.get('mime_type', '')
        factory = Image if mime.startswith('image/') else Record if mime.startswith('audio/') else Video if mime.startswith('video/') else None
        if factory is None:
            raise ValueError('Reply not sent: PCP relay/media validation — unsupported attachment type')
        chain.chain.append(factory.fromBase64(item['data']))
    chain.use_t2i_ = False
    return chain


def receipt(broker_url, creds, turn_id, status, count):
    body = json.dumps({'turn_id': turn_id, 'event_id': secrets.token_hex(16), 'status': status,
                       'attachment_count': count}, separators=(',', ':')).encode()
    request = urllib.request.Request(broker_url.rstrip('/') + '/v1/delivery', data=body, method='POST',
                                    headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + creds.token,
                                             'x-pcp-signature': sign(creds.signing_key, body)})
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            if response.status != 200: raise OSError('receipt refused')
    except (OSError, ValueError):
        logger.warning('Delivery evidence not recorded: PCP relay/receipt — broker unavailable or receipt refused; platform send result is unchanged.')


def track_delivery(event, broker_url, creds, turn_id):
    """The framework's after-send hook also runs after failures; wrap the send itself."""
    original = event.send

    async def send(chain):
        count = sum(type(part).__name__ in ('Image', 'Record', 'Video') for part in chain.chain)
        try:
            result = await original(chain)
        except Exception:
            if count:
                await asyncio.to_thread(receipt, broker_url, creds, turn_id, 'failed', count)
            raise
        if count:
            await asyncio.to_thread(receipt, broker_url, creds, turn_id, 'adapter_accepted', count)
            logger.info(f'Media handed to platform: PCP relay/delivery — {count} attachment(s), turn {turn_id}; adapter accepted, recipient display is not asserted.')
        return result

    event.send = send
