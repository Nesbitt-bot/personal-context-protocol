"""astrbot_plugin_pcp_relay: AstrBot -> PCP broker -> OpenClaw, identity-stamped.

- `on_llm_request` builds the identity stamp from the platform event
  (platform, private/group, group id, sender id, message id, time) and keeps
  it, with the latest message text, for this request only.
- The `pcp_relay` provider adapter HMAC-signs the stamp and sends it with the
  latest message to the loopback PCP broker. The broker (not AstrBot) holds
  the OpenClaw gateway token; PCP picks the agent and the readable context.
- Fail closed: no stamp, PCP or broker down, or any refusal -> no reply
  (logged). An OpenClaw failure behind a verified turn -> AstrBot's normal
  failure message.

No dependencies beyond AstrBot and the Python standard library.
"""
from __future__ import annotations

import asyncio
import contextvars
import time
from dataclasses import dataclass, field

from astrbot.api import logger
from astrbot.api.event import AstrMessageEvent, filter
from astrbot.api.provider import LLMResponse, Provider, ProviderRequest, ProviderType
from astrbot.api.star import Context, Star
from astrbot.core.provider.register import provider_cls_map, register_provider_adapter

try:
    from .pcp_relay_core import DEFAULT_BROKER_URL, DEFAULT_TIMEOUT_S, broker_url_ok, build_stamp, encode_body, load_credentials, outcome, post_turn
except ImportError:  # loaded as a top-level module (tests)
    from pcp_relay_core import DEFAULT_BROKER_URL, DEFAULT_TIMEOUT_S, broker_url_ok, build_stamp, encode_body, load_credentials, outcome, post_turn

PROVIDER_TYPE = "pcp_relay"
DEFAULT_CREDENTIALS_FILE = "/AstrBot/data/plugin_data/astrbot_plugin_pcp_relay/credentials.json"
STAMP_TTL_S = 300


@dataclass
class PendingTurn:
    umo: str
    stamp: dict | None
    text: str
    event: object
    created: float = field(default_factory=time.monotonic)


# The stamp travels with the request's task context; a short-lived map keyed
# by the unified message origin is the fallback for runners that hop tasks.
_CURRENT: contextvars.ContextVar[PendingTurn | None] = contextvars.ContextVar("pcp_relay_turn", default=None)
_BY_UMO: dict[str, PendingTurn] = {}


def _remember(turn: PendingTurn) -> None:
    _CURRENT.set(turn)
    now = time.monotonic()
    for key in [k for k, v in _BY_UMO.items() if now - v.created > STAMP_TTL_S]:
        _BY_UMO.pop(key, None)
    _BY_UMO[turn.umo] = turn


def _take(session_id: str | None) -> PendingTurn | None:
    turn = _CURRENT.get()
    if turn is None or (session_id and turn.umo != session_id):
        turn = _BY_UMO.get(session_id or "")
    if turn is None or time.monotonic() - turn.created > STAMP_TTL_S or (session_id and turn.umo != session_id):
        return None
    _BY_UMO.pop(turn.umo, None)
    _CURRENT.set(None)
    return turn


def stamp_from_event(event: AstrMessageEvent) -> dict | None:
    message = getattr(event, "message_obj", None)
    return build_stamp(
        adapter=event.get_platform_name(),
        platform_id=event.get_platform_id(),
        is_private=event.is_private_chat(),
        group_id=event.get_group_id(),
        sender_id=event.get_sender_id(),
        message_id=getattr(message, "message_id", None),
    )


class PcpRelayProvider(Provider):
    """Chat provider that only talks to the PCP broker."""

    def __init__(self, provider_config: dict, provider_settings: dict) -> None:
        super().__init__(provider_config, provider_settings)
        self.broker_url = str(provider_config.get("broker_url") or DEFAULT_BROKER_URL)
        self.credentials_file = str(provider_config.get("credentials_file") or DEFAULT_CREDENTIALS_FILE)
        self.timeout_s = float(provider_config.get("timeout") or DEFAULT_TIMEOUT_S)
        self.set_model(str(provider_config.get("model") or "broker"))

    def get_current_key(self) -> str:
        return ""

    def set_key(self, key: str) -> None:
        return None

    async def get_models(self) -> list[str]:
        return ["broker"]

    def _silent(self, turn: PendingTurn | None, reason: str) -> LLMResponse:
        logger.warning(f"PCP relay: no reply (fail closed) — {reason}.")
        event = getattr(turn, "event", None)
        if event is not None and hasattr(event, "stop_event"):
            event.stop_event()
        return LLMResponse(role="assistant", completion_text="")

    async def text_chat(self, prompt=None, session_id=None, **kwargs) -> LLMResponse:
        turn = _take(session_id)
        if turn is None or turn.stamp is None:
            return self._silent(turn, "no platform identity stamp for this request")
        if not broker_url_ok(self.broker_url):
            return self._silent(turn, "broker_url must be loopback http or https")
        creds = load_credentials(self.credentials_file)
        if creds is None:
            return self._silent(turn, "ingress credentials file missing, unreadable or not private")
        body = encode_body(turn.stamp, turn.text)
        result = await asyncio.to_thread(post_turn, self.broker_url, creds, body, self.timeout_s)
        verdict = outcome(result)
        if verdict == "reply":
            return LLMResponse(role="assistant", completion_text=result.reply)
        if verdict == "error":
            logger.warning(f"PCP relay: OpenClaw did not reply ({result.code or 'error'}).")
            return LLMResponse(role="err", completion_text="the assistant is unavailable right now")
        return self._silent(turn, f"broker answered {result.status or 'unreachable'} {result.code}".strip())

    async def text_chat_stream(self, prompt=None, session_id=None, **kwargs):
        yield await self.text_chat(prompt=prompt, session_id=session_id, **kwargs)

    async def test(self, timeout: float = 45.0) -> None:
        # No stamp outside a real platform event: verify configuration only.
        if not broker_url_ok(self.broker_url) or load_credentials(self.credentials_file) is None:
            raise RuntimeError("pcp_relay: broker_url or ingress credentials file is not usable")


# Re-registration on plugin hot reload must not raise.
if PROVIDER_TYPE in provider_cls_map:
    provider_cls_map[PROVIDER_TYPE].cls_type = PcpRelayProvider
else:
    register_provider_adapter(
        PROVIDER_TYPE,
        "PCP broker relay: identity-stamped, fail-closed (thirdparty/astrbot_plugin_pcp_relay)",
        provider_type=ProviderType.CHAT_COMPLETION,
        default_config_tmpl={
            "id": "pcp_relay",
            "type": PROVIDER_TYPE,
            "provider_type": "chat_completion",
            "enable": True,
            "key": [""],
            "broker_url": DEFAULT_BROKER_URL,
            "credentials_file": DEFAULT_CREDENTIALS_FILE,
            "timeout": DEFAULT_TIMEOUT_S,
        },
        provider_display_name="PCP relay",
    )(PcpRelayProvider)


class PcpRelayPlugin(Star):
    def __init__(self, context: Context, config=None) -> None:
        super().__init__(context)

    @filter.on_llm_request()
    async def stamp_request(self, event: AstrMessageEvent, req: ProviderRequest) -> None:
        """Attach the platform identity to this LLM request (pcp_relay reads it)."""
        text = (event.get_message_str() or "").strip() or str(getattr(req, "prompt", "") or "").strip()
        _remember(PendingTurn(umo=str(event.unified_msg_origin), stamp=stamp_from_event(event), text=text, event=event))
