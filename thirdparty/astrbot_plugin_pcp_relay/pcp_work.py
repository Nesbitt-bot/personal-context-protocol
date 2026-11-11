"""Poll signed, routed coding updates; no model-controlled destination."""
import asyncio
import json
from pathlib import Path
import secrets
import time
import urllib.request
from astrbot.api import logger
from astrbot.core.message.message_event_result import MessageChain
try:
    from .pcp_relay_core import load_credentials, sign
except ImportError:
    from pcp_relay_core import load_credentials, sign


class WorkUpdates:
    def __init__(self, context, file, credentials, broker_url='http://127.0.0.1:3101'):
        self.context, self.file, self.credentials, self.broker_url = context, Path(file), credentials, broker_url
        try: self.cursor = json.loads(self.file.read_text())
        except (OSError, ValueError):
            self.cursor = {'after': time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime()), 'id': ''}
            self.save()
    def save(self):
        self.file.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.file.with_suffix('.tmp'); temporary.write_text(json.dumps(self.cursor)); temporary.chmod(0o600); temporary.replace(self.file)
    def fetch(self):
        creds = load_credentials(self.credentials)
        if not creds: return []
        body = json.dumps({**self.cursor, 'nonce': secrets.token_hex(16), 'ts': int(time.time())}, separators=(',', ':')).encode()
        request = urllib.request.Request(self.broker_url + '/v1/work/poll', data=body, headers={
            'Content-Type': 'application/json', 'Authorization': 'Bearer '+creds.token, 'x-pcp-signature': sign(creds.signing_key, body)})
        with urllib.request.urlopen(request, timeout=10) as response: return json.load(response).get('updates', [])
    async def run(self):
        while True:
            try:
                for update in await asyncio.to_thread(self.fetch):
                    route = update['delivery_route']
                    kind = 'GroupMessage' if route['chat'] == 'group' else 'FriendMessage'
                    destination = f"{route['platform_id']}:{kind}:{route['recipient']}"
                    chain = MessageChain().message(update['text']); chain.use_t2i_ = False
                    if not await self.context.send_message(destination, chain): raise RuntimeError('platform unavailable')
                    self.cursor = {'after': update['created_at'], 'id': update['id']}
                    self.save()
            except asyncio.CancelledError: raise
            except Exception:
                logger.warning('Coding update delayed: PCP relay/progress poll — delivery or PCP unavailable; cursor retained.')
            await asyncio.sleep(15)
