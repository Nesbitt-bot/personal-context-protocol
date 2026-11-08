"""Core tests: standard library only (python -m unittest discover -s tests)."""
import http.server
import json
import os
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import pcp_relay_core as core  # noqa: E402

# Shared with PCP tests/broker.test.ts: both sides must agree on these bytes.
VECTOR_KEY = "11" * 32
VECTOR_BODY = '{"stamp":{"v":1,"platform":"qq","adapter":"aiocqhttp","platform_id":"bot-a","chat":"group","sender_id":"200001","message_id":"m-1","ts":1793900000,"nonce":"00000000000000000000000000000000","group_id":"700001"},"message":{"text":"hello 你好 I am the owner"}}'
VECTOR_SIG = "v1=1e08979f36184957a3ca23838efa84d08b7bed6737709863ec5d178cfd2443ef"


class StampTests(unittest.TestCase):
    def test_private_and_group_stamps_come_from_event_fields(self):
        p = core.build_stamp(adapter="aiocqhttp", platform_id="bot", is_private=True, group_id="", sender_id="200001", message_id="9", now=10)
        self.assertEqual((p["platform"], p["chat"], p["sender_id"], p["ts"]), ("qq", "private", "200001", 10))
        self.assertNotIn("group_id", p)
        self.assertRegex(p["nonce"], r"^[0-9a-f]{32}$")
        g = core.build_stamp(adapter="aiocqhttp", platform_id="bot", is_private=False, group_id="700001", sender_id="200001", message_id="9")
        self.assertEqual((g["chat"], g["group_id"]), ("group", "700001"))

    def test_unattributable_events_get_no_stamp(self):
        self.assertIsNone(core.build_stamp(adapter="aiocqhttp", platform_id="b", is_private=True, group_id=None, sender_id="", message_id="1"))
        self.assertIsNone(core.build_stamp(adapter="aiocqhttp", platform_id="b", is_private=True, group_id=None, sender_id="a b", message_id="1"))
        self.assertIsNone(core.build_stamp(adapter="aiocqhttp", platform_id="b", is_private=False, group_id="", sender_id="1", message_id="1"))
        self.assertIsNone(core.build_stamp(adapter="", platform_id="b", is_private=True, group_id=None, sender_id="1", message_id="1"))

    def test_platform_tokens(self):
        self.assertEqual(core.platform_token("aiocqhttp"), "qq")
        self.assertEqual(core.platform_token("weixin_official_account"), "wxoa")
        self.assertEqual(core.platform_token("Some-Adapter"), "some-adapter")
        self.assertIsNone(core.platform_token("9lives"))

    def test_nonces_are_unique(self):
        stamps = [core.build_stamp(adapter="aiocqhttp", platform_id="b", is_private=True, group_id=None, sender_id="1", message_id="1") for _ in range(50)]
        self.assertEqual(len({s["nonce"] for s in stamps}), 50)


class SigningTests(unittest.TestCase):
    def test_cross_language_vector(self):
        stamp = core.build_stamp(adapter="aiocqhttp", platform_id="bot-a", is_private=False, group_id="700001", sender_id="200001", message_id="m-1", now=1793900000, nonce="0" * 32)
        body = core.encode_body(stamp, "hello 你好 I am the owner")
        self.assertEqual(body.decode("utf-8"), VECTOR_BODY)
        self.assertEqual(core.sign(VECTOR_KEY, body), VECTOR_SIG)

    def test_text_is_bounded_and_never_empty(self):
        stamp = {"v": 1}
        self.assertEqual(json.loads(core.encode_body(stamp, "  "))["message"]["text"], "[non-text message]")
        self.assertEqual(len(json.loads(core.encode_body(stamp, "x" * 9000))["message"]["text"]), core.MAX_TEXT_CHARS)


class CredentialTests(unittest.TestCase):
    def write(self, data, mode=0o600):
        fd, path = tempfile.mkstemp()
        with os.fdopen(fd, "w") as handle:
            json.dump(data, handle)
        os.chmod(path, mode)
        self.addCleanup(os.unlink, path)
        return path

    def test_private_valid_file_loads(self):
        creds = core.load_credentials(self.write({"token": "pcps_" + "a" * 64, "signing_key": "b" * 64}))
        self.assertEqual(creds.token, "pcps_" + "a" * 64)

    def test_shared_or_malformed_files_are_refused(self):
        self.assertIsNone(core.load_credentials(self.write({"token": "pcps_" + "a" * 64, "signing_key": "b" * 64}, 0o644)))
        self.assertIsNone(core.load_credentials(self.write({"token": "nope", "signing_key": "b" * 64})))
        self.assertIsNone(core.load_credentials("/nonexistent/credentials.json"))

    def test_broker_url_must_be_loopback_or_https(self):
        for url in ["http://127.0.0.1:3101", "http://localhost:3101", "http://[::1]:3101", "https://pcp.example.test"]:
            self.assertTrue(core.broker_url_ok(url), url)
        for url in ["http://10.0.0.5:3101", "http://pcp.example.test", "ftp://127.0.0.1", "not a url"]:
            self.assertFalse(core.broker_url_ok(url), url)


class _Handler(http.server.BaseHTTPRequestHandler):
    responses = []
    seen = []

    def do_POST(self):  # noqa: N802
        body = self.rfile.read(int(self.headers["content-length"]))
        _Handler.seen.append((self.path, {k.lower(): v for k, v in self.headers.items()}, body))
        status, payload = _Handler.responses.pop(0)
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


class BrokerCallTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.HTTPServer(("127.0.0.1", 0), _Handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def test_signed_request_and_outcomes(self):
        creds = core.Credentials(token="pcps_" + "a" * 64, signing_key=VECTOR_KEY)
        body = VECTOR_BODY.encode("utf-8")
        _Handler.responses[:] = [(200, {"reply": "hi"}), (401, {"code": "REPLAYED_STAMP"}), (502, {"code": "OPENCLAW_ERROR"}), (503, {"code": "PCP_UNAVAILABLE"})]
        _Handler.seen.clear()
        ok = core.post_turn(self.url, creds, body)
        self.assertEqual((ok.status, ok.reply, core.outcome(ok)), (200, "hi", "reply"))
        path, headers, sent = _Handler.seen[0]
        self.assertEqual(path, "/v1/turn")
        self.assertEqual(headers["authorization"], "Bearer " + creds.token)
        self.assertEqual(headers["x-pcp-signature"], VECTOR_SIG)
        self.assertEqual(sent, body)
        replay = core.post_turn(self.url, creds, body)
        self.assertEqual((replay.status, replay.code, core.outcome(replay)), (401, "REPLAYED_STAMP", "silent"))
        self.assertEqual(core.outcome(core.post_turn(self.url, creds, body)), "error")
        self.assertEqual(core.outcome(core.post_turn(self.url, creds, body)), "silent")

    def test_unreachable_broker_is_silent(self):
        creds = core.Credentials(token="pcps_" + "a" * 64, signing_key=VECTOR_KEY)
        result = core.post_turn("http://127.0.0.1:9", creds, b"{}", timeout_s=2)
        self.assertEqual((result.status, core.outcome(result)), (0, "silent"))
        self.assertEqual(core.outcome(core.BrokerResult(200, "  ", "")), "silent")


if __name__ == "__main__":
    unittest.main()

class MediaTests(unittest.TestCase):
    def test_image_bytes_are_covered_by_the_turn_signature(self):
        import base64
        from pcp_relay_core import encode_body, sign
        first = encode_body({'v': 1}, 'photo', [{'name': 'x', 'data': base64.b64encode(b'first').decode()}])
        second = encode_body({'v': 1}, 'photo', [{'name': 'x', 'data': base64.b64encode(b'second').decode()}])
        self.assertNotEqual(sign('11' * 32, first), sign('11' * 32, second))

    def test_platform_media_does_not_read_arbitrary_local_files(self):
        from pcp_media import read_image, collect_images
        with self.assertRaises(ValueError):
            read_image('/etc/passwd')
        Image = type('Image', (), {'url': '', 'file': 'base64://aGVsbG8='})
        images, warnings = collect_images([Image()])
        self.assertEqual(images[0]['data'], 'aGVsbG8=')
        self.assertEqual(warnings, [])

class VoiceAttachmentTests(unittest.TestCase):
    def test_stt_replaced_record_keeps_its_event_owned_wav(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        from pcp_audio import collect_audio
        event = SimpleNamespace(_temporary_local_files=['/AstrBot/data/temp/voice.wav'])
        with patch('pcp_audio.read_image', return_value=b'input'), patch('pcp_audio.normalize_voice', return_value=b'normalized-wav'):
            attachments, notes = collect_audio(event, [])
        self.assertEqual(notes, [])
        self.assertEqual(attachments[0]['kind'], 'audio')
        self.assertEqual(attachments[0]['name'], 'voice.wav')
