# Current Limits

This page lists only behavior that affects the current app. Roadmap items live in [TODO.md](TODO.md).

- Single admin token model.
- No token revocation UI.
- No UI token rotation flow.
- Session search requires the private OpenSearch stack. The navbar returns up to 20 ranked sessions without pagination.
- No import endpoints.
- Minimal admin UI.

Intentional constraints:

- AI tokens cannot manage topics.
- AI tokens are scoped to one session.
- Messages are append-only.
