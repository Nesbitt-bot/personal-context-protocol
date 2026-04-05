# Personal Context Protocol

Personal Context Protocol (PCP) is a local-first prototype for a **Human Context Protocol / Human Data Access Protocol** controller.

The core idea from the conversation that motivated this repository is simple:

- a note application is not the long-term moat
- a giant personal RAG is still too weak as a security boundary
- the durable layer is a **local policy controller** that decides what data an external or less-trusted AI agent may see, in what form, for how long, and under what write constraints

This repository prototypes a system in which:

- **Human** owns the data and the final authority
- **Local AI A** acts as a local orchestrator / policy assistant
- **Remote or unknown AI B** is treated as useful but not fully trusted
- credentials are never handed out directly when a scoped lease or mediated access can be used instead
- the system attempts to maximize task completion while minimizing raw data exposure

## Design target

The target is **not** a better note app.

The target is a local controller that:

1. stores or indexes canonical personal data locally
2. classifies sensitivity
3. constructs task-scoped context bundles
4. mediates credential use
5. requires approval for high-risk reads or any writeback
6. keeps an audit trail

In short:

> maximize task utility under least-privilege, minimum-data, auditable access control.

## Threat model

This repository assumes the following are true:

- prompt injection is a persistent risk
- remote models can be useful without being fully trusted
- local models are safer than remote models only in a **relative** sense
- no single model should be trusted as a perfect security oracle
- enforcement must rely on deterministic policy, validation, and approval paths rather than on language-model judgment alone

## Prototype overview

The prototype in `src/pcp/protocol.py` models:

- `DataAsset` with sensitivity labels
- `TaskRequest` from a remote agent
- `PolicyEngine` that creates minimal context bundles
- `ApprovalQueue` for asynchronous human review
- `CredentialVault` that issues scoped leases instead of exposing raw credentials
- `PersonalContextController` that separates read, propose, approve, and commit

### Current behavior

- low-risk requests can receive redacted or summary data automatically
- secret / intimate data is queued for approval
- write operations are never auto-committed
- credential requests return a **lease handle**, not the credential itself
- the controller logs what it did and why

## Why asynchronous human-agent collaboration matters

A realistic system should not force all decisions into synchronous chat approval.

Instead, PCP should support:

- queued requests
- delayed approvals
- expiration windows
- policy presets by requester / task type / data sensitivity
- reversible proposals instead of direct writes

This allows a human and multiple AI agents to collaborate without requiring raw, continuous, unrestricted access.

## Security concerns, especially for local AI A

A local model is **not** automatically safe just because it runs locally.

Important concerns include:

1. **Prompt injection via local content**
   - a local model can still read malicious notes, repo files, emails, or web captures
   - locality does not eliminate injection

2. **Credential overreach**
   - if the local controller can directly read and emit raw credentials, compromise of that controller becomes catastrophic
   - the safer pattern is lease issuance, capability scoping, and mediated execution

3. **Policy confusion**
   - if the model itself interprets policy text instead of a deterministic engine enforcing it, boundary violations become likely

4. **Provenance collapse**
   - without clear distinction between raw user data, model summaries, external content, and derived conclusions, the system cannot defend against context poisoning

5. **Silent writeback risk**
   - the most dangerous failure mode is not reading too much once, but gradually modifying memory, credentials, repos, or automation policies with insufficient review

For that reason, this repo treats the local model as a **policy assistant**, not a root-of-trust.

## Suggested system architecture

```text
Human
  ↓
Local canonical data store / event log / sensitivity labels
  ↓
Deterministic policy engine + audit log + credential vault
  ↓
Local AI A (planner / summarizer / broker)
  ↓
Task-scoped context bundle + capability leases
  ↓
Remote AI B / external agent
  ↓
Proposal only (no implicit commit)
  ↓
Validation / human approval / commit
```

## Research references

The prototype and security notes are aligned with several recent research directions on LLM agent security, privilege control, and prompt-injection resistance:

1. **Progent: Programmable Privilege Control for LLM Agents** (2025)  
   https://www.semanticscholar.org/paper/fa4cb03e73a53f67386775c2cab44da0afbe91eb

2. **Prompt Flow Integrity to Prevent Privilege Escalation in LLM Agents** (2025)  
   https://www.semanticscholar.org/paper/f1db7984b7ca19fd22e74f14ca4f9a5da74ba407

3. **Imprompter: Tricking LLM Agents into Improper Tool Use** (2024)  
   https://www.semanticscholar.org/paper/7c834a7ba43a2b5067817426939c362eb06fdb2a

4. **MiniScope: A Least Privilege Framework for Authorizing Tool Calling Agents** (2025)  
   https://www.semanticscholar.org/paper/6d4eb9782c6707c9e66229532f451e5ee0facd7e

5. **Agent Security Bench (ASB): Formalizing and Benchmarking Attacks and Defenses in LLM-based Agents** (2024)  
   https://www.semanticscholar.org/paper/5f4efbe3aae1d8f44ceab1da257ae685d6beb00b

These works support the same general conclusion reached in the conversation:

- do not rely on one model to be perfectly robust
- separate policy from model cognition
- prefer least privilege
- control tool use and writeback explicitly
- benchmark attacks and defenses continuously

## Quick start

```bash
python -m unittest discover -s tests -v
python -m src.pcp.demo
```

## Roadmap

- add explicit provenance / taint labels
- add signed approval records
- add context-expiry and revocation
- add structured connector adapters for repo, diary, chat, and filesystem data
- add MCP-facing tool endpoints for PCP bundles and proposal queues
- add HCP schemas for sensitivity, trust tier, and data purpose

## Repository naming note

GitHub repository slugs cannot contain spaces, so the repo is created as:

- `personal-context-protocol`

while the project title remains:

- **Personal Context Protocol**
