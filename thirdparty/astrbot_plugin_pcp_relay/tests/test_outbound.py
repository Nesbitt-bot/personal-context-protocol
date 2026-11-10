import asyncio
import base64
import hashlib
import importlib
import sys
import types
import unittest
from unittest.mock import AsyncMock, patch


class OutboundTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from test_main import _install_astrbot_stubs
        _install_astrbot_stubs()
        components = types.ModuleType('astrbot.api.message_components')
        for name in ['Image', 'Record', 'Video']:
            component = type(name, (), {'fromBase64': classmethod(lambda cls, data: cls(data)), '__init__': lambda self, data: setattr(self, 'data', data)})
            setattr(components, name, component)
        components.Plain = type('Plain', (), {'__init__': lambda self, text: setattr(self, 'text', text)})
        chain = types.ModuleType('astrbot.core.message.message_event_result')
        chain.MessageChain = type('MessageChain', (), {'__init__': lambda self: setattr(self, 'chain', [])})
        sys.modules['astrbot.api.message_components'] = components
        sys.modules['astrbot.core.message'] = types.ModuleType('astrbot.core.message')
        sys.modules['astrbot.core.message.message_event_result'] = chain
        cls.outbound = importlib.import_module('pcp_outbound')

    def test_text_and_media_only_replies_build_real_components(self):
        for mime, name in [('image/jpeg', 'Image'), ('audio/wav', 'Record'), ('video/mp4', 'Video')]:
            media = {'data': base64.b64encode(b'fixture').decode(), 'mime_type': mime, 'sha256': hashlib.sha256(b'fixture').hexdigest()}
            chain = self.outbound.reply_chain('caption', [media])
            self.assertEqual([type(x).__name__ for x in chain.chain], ['Plain', name])
            self.assertEqual(len(self.outbound.reply_chain('', [media]).chain), 1)
            with self.assertRaises(ValueError): self.outbound.reply_chain('', [{**media, 'sha256': 'wrong'}])

    def test_receipt_depends_on_actual_send_result_not_the_after_send_hook(self):
        async def run():
            chain = self.outbound.reply_chain('', [{'data': 'eA==', 'mime_type': 'image/jpeg', 'sha256': hashlib.sha256(b'x').hexdigest()}])
            event = types.SimpleNamespace(send=AsyncMock())
            with patch.object(self.outbound, 'receipt') as receipt:
                self.outbound.track_delivery(event, 'http://localhost', object(), 'turn')
                await event.send(chain)
                self.assertEqual(receipt.call_args.args[-2:], ('adapter_accepted', 1))
            event = types.SimpleNamespace(send=AsyncMock(side_effect=RuntimeError('platform unavailable')))
            with patch.object(self.outbound, 'receipt') as receipt:
                self.outbound.track_delivery(event, 'http://localhost', object(), 'turn')
                with self.assertRaises(RuntimeError): await event.send(chain)
                self.assertEqual(receipt.call_args.args[-2:], ('failed', 1))
        asyncio.run(run())
