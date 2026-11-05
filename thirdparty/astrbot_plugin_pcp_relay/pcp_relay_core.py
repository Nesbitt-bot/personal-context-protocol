"""Pure, dependency-free core of astrbot_plugin_pcp_relay (standard library only).

The identity stamp is built from the platform event (never from message
text), signed with HMAC-SHA256 and sent with the latest message to the
loopback PCP broker. PCP verifies the ingress credential, the signature, the
replay window and the nonce, then decides everything else.
"""
from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import os
import re
import secrets
import stat
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from urllib.parse import urlsplit

STAMP_VERSION = 1
MAX_TEXT_CHARS = 8000
DEFAULT_BROKER_URL = "http://127.0.0.1:3101"
DEFAULT_TIMEOUT_S = 240.0

# AstrBot adapter type -> PCP principal platform token (astrbot:<token>:<id>).
PLATFORM_TOKENS = {
    "aiocqhttp": "qq",
    "qq_official": "qqofficial",
    "qq_official_webhook": "qqofficial",
    "weixin_official_account": "wxoa",
    "wecom": "wecom",
    "telegram": "telegram",
    "discord": "discord",
    "lark": "lark",
    "dingtalk": "dingtalk",
    "slack": "slack",
    "kook": "kook",
}
_TOKEN_RE = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")
_ID_RE = re.compile(r"^[A-Za-z0-9._@+=-]{1,128}$")


def platform_token(adapter: str | None) -> str | None:
    if not adapter:
        return None
    token = PLATFORM_TOKENS.get(adapter) or re.sub(r"[^a-z0-9_-]", "", str(adapter).lower())[:32]
    return token if _TOKEN_RE.match(token) else None


def build_stamp(
    *,
    adapter: str | None,
    platform_id: str | None,
    is_private: bool,
    group_id: str | None,
    sender_id: str | None,
    message_id: str | None,
    now: float | None = None,
    nonce: str | None = None,
) -> dict | None:
    """The stamp, or None when the event cannot be attributed (fail closed)."""
    token = platform_token(adapter)
    sender = str(sender_id or "")
    if not token or not _ID_RE.match(sender):
        return None
    stamp = {
        "v": STAMP_VERSION,
        "platform": token,
        "adapter": str(adapter)[:64],
        "platform_id": str(platform_id or "")[:128],
        "chat": "private" if is_private else "group",
        "sender_id": sender,
        "message_id": (str(message_id) if message_id not in (None, "") else f"local-{secrets.token_hex(8)}")[:128],
        "ts": int(now if now is not None else time.time()),
        "nonce": nonce or secrets.token_hex(16),
    }
    if not is_private:
        group = str(group_id or "")
        if not _ID_RE.match(group):
            return None
        stamp["group_id"] = group
    return stamp


def encode_body(stamp: dict, text: str) -> bytes:
    """Canonical compact JSON; the HMAC covers exactly these bytes."""
    clean = (text or "").strip()[:MAX_TEXT_CHARS] or "[non-text message]"
    return json.dumps({"stamp": stamp, "message": {"text": clean}}, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sign(signing_key_hex: str, body: bytes) -> str:
    return "v1=" + hmac.new(bytes.fromhex(signing_key_hex), body, hashlib.sha256).hexdigest()


@dataclass(frozen=True)
class Credentials:
    token: str
    signing_key: str


def load_credentials(path: str) -> Credentials | None:
    """`{"token": "pcps_...", "signing_key": "<64 hex>"}`; refuses world/group-readable files."""
    try:
        info = os.stat(path)
        if info.st_mode & (stat.S_IRWXG | stat.S_IRWXO):
            return None
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return None
    token, key = str(data.get("token", "")), str(data.get("signing_key", ""))
    if not re.fullmatch(r"pcps_[0-9a-f]{64}", token) or not re.fullmatch(r"[0-9a-f]{64}", key):
        return None
    return Credentials(token=token, signing_key=key)


def broker_url_ok(url: str) -> bool:
    """Loopback http, or https; the broker is never reachable from elsewhere."""
    try:
        parts = urlsplit(url)
        if parts.scheme == "https":
            return bool(parts.hostname)
        if parts.scheme != "http" or not parts.hostname:
            return False
        return parts.hostname == "localhost" or ipaddress.ip_address(parts.hostname).is_loopback
    except ValueError:
        return False


@dataclass(frozen=True)
class BrokerResult:
    status: int  # 0 = unreachable
    reply: str
    code: str


def post_turn(broker_url: str, creds: Credentials, body: bytes, timeout_s: float = DEFAULT_TIMEOUT_S, opener=urllib.request.urlopen) -> BrokerResult:
    """Blocking call (run it in a thread). Never raises; never logs secrets."""
    request = urllib.request.Request(
        broker_url.rstrip("/") + "/v1/turn",
        data=body,
        method="POST",
        headers={
            "content-type": "application/json",
            "authorization": f"Bearer {creds.token}",
            "x-pcp-signature": sign(creds.signing_key, body),
        },
    )
    try:
        with opener(request, timeout=timeout_s) as response:
            payload = json.loads(response.read().decode("utf-8") or "{}")
            return BrokerResult(response.status, str(payload.get("reply") or ""), "")
    except urllib.error.HTTPError as error:
        try:
            code = str(json.loads(error.read().decode("utf-8") or "{}").get("code") or "")
        except (ValueError, OSError):
            code = ""
        return BrokerResult(error.code, "", code[:40])
    except (urllib.error.URLError, OSError, ValueError):
        return BrokerResult(0, "", "UNREACHABLE")


def outcome(result: BrokerResult) -> str:
    """'reply' | 'error' (AstrBot shows its failure message) | 'silent' (fail closed)."""
    if result.status == 200 and result.reply.strip():
        return "reply"
    if result.status == 502:
        return "error"  # OpenClaw failed behind a verified, recorded turn
    return "silent"  # PCP/broker down, unauthenticated, replayed, refused
