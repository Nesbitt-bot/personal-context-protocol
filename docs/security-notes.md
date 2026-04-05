# Security Notes for Personal Context Protocol

## Local-first is safer, not sufficient

Local execution reduces external exposure but does not eliminate:

- prompt injection
- policy confusion
- malicious local content
- over-broad tool permissions
- accidental or silent writeback
- credential leakage through logs, memory, or summaries

## Security goal

The goal is not perfect model judgment.

The goal is:

- bounded damage
- explicit approvals for high-risk actions
- minimum-data context packaging
- capability-scoped credential use
- strong provenance
- replaceable models with stable enforcement

## Engineering principles

1. **No raw credential release by default**
   - issue short-lived lease handles instead of secrets
   - mediate execution close to the credential boundary

2. **No direct high-impact writes from remote agents**
   - remote agents propose
   - local validators check
   - human or deterministic policy approves
   - only then commit

3. **Treat all external content as adversarial by default**
   - repositories, notes, tickets, emails, webpages, logs

4. **Enforce least privilege with deterministic code**
   - models may request capabilities
   - models do not grant themselves capabilities

5. **Keep the local model below the root of trust**
   - the local model helps plan and summarize
   - the local controller enforces

## Realistic deployment stance

A practical PCP deployment should assume the local model will sometimes be wrong.

Therefore the system should remain acceptable under:

- false approvals being rare and bounded
- prompt injection attempts being frequent
- context bundles being incomplete by design
- some tasks being delayed for approval rather than immediately solved

That trade-off is intentional.
