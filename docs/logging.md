# Logging Guidelines (PCP)

Follows AGENTS.md §1.4.1 - File logging convention.

## Overview

All long-running operations must emit structured logs to:
- `~/.pcp-logs/run-YYYYMMDD-HHMMSS.log`
- Console output (INFO level+)

## Usage

```python
from src.lib.logging import setup_logger, log_message

# Initialize logger
logger = setup_logger(__name__)

# Log milestones (kept forever)
logger.info("Database connection established")
logger.info("Starting batch processing: 1000 items")

# Log progress (may be aged by age)
logger.debug(f"Processed item {i} of {total}")

# Log warnings/errors (never aged out)
logger.warning("Rate limit approaching: 450/500 requests")
logger.error(f"Failed to process item {i}: {error}")

# Or use convenience function
log_message("INFO", "Operation completed successfully")
```

## Log Levels

| Level | Usage | Retention |
|-------|-------|---┬------|
| INFO | Stage milestones, progress updates | Kept forever |
| DEBUG | High-frequency detail, per-item progress | Aged by age (3 days) |
| WARNING | Non-fatal issues, approaching limits | Never aged |
| ERROR | Failed operations, exceptions | Never aged |
| CRITICAL | System failures, data corruption | Never aged |

## File Structure

One file per run:
```
~/.pcp-logs/
├── run-20260623-143022.log   # Current run
├── run-20260623-091545.log   # Previous runs (7 days kept)
└── run-20260622-184533.log
```

## Formatting

Machine-greppable format:
```
2026-06-23 14:30:22 [INFO] pcp.api: Starting message append for session ses_xxx
2026-06-23 14:30:23 [DEBUG] pcp.db: Query executed in 45ms
2026-06-23 14:30:24 [WARNING] pcp.rate: Approaching limit: 450/500
```

## Secrets

Never log:
- Database passwords
- API tokens
- Session tokens
- `.env` file contents

Log only:
- File basename (not path)
- Operation names (not data)
- Counts/metrics (not payloads)

## Long-running operations

For operations > 1 minute:
1. Log start with ETA
2. Log progress at meaningful milestones
3. Log checkpoint at > 1 hour intervals
4. Log completion or failure

Example:
```python
logger.info("Starting dataset processing: ~2 hours")
logger.info("Stage 1: Data loaded (10000 records)")
logger.debug("Processing batch 1/100...")
logger.debug("Processing batch 50/100...")
logger.info("Checkpoint: 50% complete, ETA 1 hour")
logger.info("Stage 2: Processing complete")
logger.info("Operation finished: 2 hours 15 minutes")
```

## Notifications

If `*.bark.env` exists, send silent pushes at:
- Process start
- Major stage boundaries
- Checkpoints (> 1 hour)
- Completion / failure

Never echo config values in logs.
