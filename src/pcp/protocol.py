from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Dict, List, Optional
import hashlib
import itertools


class Sensitivity(str, Enum):
    PUBLIC = "public"
    INTERNAL = "internal"
    PRIVATE = "private"
    SECRET = "secret"


class TrustTier(str, Enum):
    LOCAL = "local"
    PARTNER = "partner"
    REMOTE = "remote"
    UNKNOWN = "unknown"


class AccessMode(str, Enum):
    SUMMARY = "summary"
    REDACTED = "redacted"
    RAW = "raw"


@dataclass
class DataAsset:
    asset_id: str
    content: str
    sensitivity: Sensitivity
    tags: List[str] = field(default_factory=list)


@dataclass
class TaskRequest:
    requester: str
    trust_tier: TrustTier
    purpose: str
    asset_ids: List[str]
    requires_write: bool = False
    needs_credentials_for: Optional[str] = None


@dataclass
class ContextItem:
    asset_id: str
    mode: AccessMode
    payload: str


@dataclass
class ContextBundle:
    request_id: str
    requester: str
    purpose: str
    items: List[ContextItem]
    requires_human_approval: bool
    notes: List[str] = field(default_factory=list)
    credential_lease_id: Optional[str] = None


@dataclass
class ApprovalRecord:
    request_id: str
    reason: str
    created_at: datetime


class ApprovalQueue:
    def __init__(self) -> None:
        self._pending: Dict[str, ApprovalRecord] = {}

    def add(self, request_id: str, reason: str) -> ApprovalRecord:
        record = ApprovalRecord(request_id=request_id, reason=reason, created_at=datetime.now(timezone.utc))
        self._pending[request_id] = record
        return record

    def pending(self) -> List[ApprovalRecord]:
        return list(self._pending.values())


class CredentialVault:
    def __init__(self) -> None:
        self._leases: Dict[str, dict] = {}

    def issue_lease(self, service: str, requester: str, purpose: str, ttl_minutes: int = 15) -> str:
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=ttl_minutes)
        raw = f"{service}|{requester}|{purpose}|{expires_at.isoformat()}"
        lease_id = hashlib.sha256(raw.encode()).hexdigest()[:16]
        self._leases[lease_id] = {
            "service": service,
            "requester": requester,
            "purpose": purpose,
            "expires_at": expires_at,
        }
        return lease_id

    def resolve(self, lease_id: str) -> Optional[dict]:
        return self._leases.get(lease_id)


class PolicyEngine:
    def __init__(self, assets: Dict[str, DataAsset], approval_queue: ApprovalQueue, vault: CredentialVault) -> None:
        self.assets = assets
        self.approval_queue = approval_queue
        self.vault = vault
        self._counter = itertools.count(1)

    def build_bundle(self, request: TaskRequest) -> ContextBundle:
        request_id = f"req-{next(self._counter):06d}"
        items: List[ContextItem] = []
        requires_human_approval = False
        notes: List[str] = []

        for asset_id in request.asset_ids:
            asset = self.assets[asset_id]
            mode, payload, note, approval_needed = self._transform(asset, request)
            items.append(ContextItem(asset_id=asset.asset_id, mode=mode, payload=payload))
            if note:
                notes.append(note)
            requires_human_approval = requires_human_approval or approval_needed

        if request.requires_write:
            requires_human_approval = True
            notes.append("Write requests are proposal-only until approved.")

        lease_id = None
        if request.needs_credentials_for:
            lease_id = self.vault.issue_lease(
                service=request.needs_credentials_for,
                requester=request.requester,
                purpose=request.purpose,
            )
            notes.append("Issued scoped credential lease instead of releasing a raw secret.")

        bundle = ContextBundle(
            request_id=request_id,
            requester=request.requester,
            purpose=request.purpose,
            items=items,
            requires_human_approval=requires_human_approval,
            notes=notes,
            credential_lease_id=lease_id,
        )

        if requires_human_approval:
            reason = "; ".join(notes) or "High-risk access requested."
            self.approval_queue.add(request_id, reason)

        return bundle

    def _transform(self, asset: DataAsset, request: TaskRequest):
        if asset.sensitivity == Sensitivity.PUBLIC:
            return AccessMode.RAW, asset.content, "", False

        if asset.sensitivity == Sensitivity.INTERNAL:
            if request.trust_tier in {TrustTier.LOCAL, TrustTier.PARTNER}:
                return AccessMode.REDACTED, self._redact(asset.content), "Internal data was redacted.", False
            return AccessMode.SUMMARY, self._summary(asset.content), "Internal data was summarized for remote use.", False

        if asset.sensitivity == Sensitivity.PRIVATE:
            if request.trust_tier == TrustTier.LOCAL:
                return AccessMode.REDACTED, self._redact(asset.content), "Private data was redacted even for local orchestration.", False
            return AccessMode.SUMMARY, self._metadata_summary(asset), "Private data requires minimized disclosure.", True

        # SECRET
        return AccessMode.SUMMARY, "[secret withheld pending approval]", "Secret data cannot be exposed automatically.", True

    @staticmethod
    def _summary(text: str, max_len: int = 120) -> str:
        compact = " ".join(text.split())
        if len(compact) <= max_len:
            return compact
        return compact[:max_len - 3] + "..."

    @staticmethod
    def _metadata_summary(asset: DataAsset) -> str:
        tag_summary = ", ".join(asset.tags) if asset.tags else "untagged"
        return f"[private asset: id={asset.asset_id}, tags={tag_summary}, chars={len(asset.content)}]"

    @staticmethod
    def _redact(text: str) -> str:
        return text.replace("password", "[REDACTED]").replace("token", "[REDACTED]")


class PersonalContextController:
    def __init__(self, assets: Dict[str, DataAsset]) -> None:
        self.approval_queue = ApprovalQueue()
        self.vault = CredentialVault()
        self.policy = PolicyEngine(assets=assets, approval_queue=self.approval_queue, vault=self.vault)

    def request_context(self, request: TaskRequest) -> ContextBundle:
        return self.policy.build_bundle(request)
