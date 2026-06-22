# PCP Limitations (v0.1)

## Current limitations

### Authentication

- **Single user only**: No multi-user support
- **No password login**: Uses single instance token
- **No OAuth/SSO**: External auth providers not supported
- **No session management**: Admin token is stateless

### AI capabilities

- **No vector search**: Messages stored as plain text, no semantic search
- **No summarization**: Messages stored verbatim, no automatic summaries
- **No context compression**: All messages included in session context
- **No auto-tagging**: Topics must be created manually
- **No smart suggestions**: Session titles must be manually suggested

### Token management

- **No expiration by default**: Tokens don't expire unless explicitly set
- **No automatic rotation**: Must manually revoke and regenerate
- **No IP restrictions**: Tokens work from any IP
- **No usage limits**: No rate limiting per token (only global)

### Data features

- **No message editing**: Messages are immutable (intentional)
- **No message deletion**: Soft deletes only for topics/sessions
- **No full-text search**: Basic filtering only
- **No attachments**: Text/markdown content only
- **No encryption**: Data at rest uses Postgres default (no app-level encryption)

### UI features

- **Minimal UI**: Basic CRUD only
- **No real-time updates**: No WebSocket/SSE
- **No pagination**: All results returned at once
- **No bulk operations**: One-at-a-time actions
- **No dark mode**: Basic styling only

### API features

- **No GraphQL**: REST only
- **No webhooks**: No event notifications
- **No batch endpoints**: One request per operation
- **No API versioning beyond v1**: All routes use /api/v1/

## Planned for v0.2+

- [ ] Multi-user support with individual auth
- [ ] OAuth/SSO integration
- [ ] Vector search for semantic retrieval
- [ ] Token expiration and automatic rotation
- [ ] Real-time updates via WebSocket
- [ ] Message search and filtering
- [ ] Bulk operations
- [ ] Dark mode UI
- [ ] Attachment support
- [ ] Export to other formats (Markdown, PDF)

## Workarounds

### If you need multi-user
- Deploy separate instances per user
- Use database-level row-level security (manual)

### If you need search
- Use external search tool (e.g., grep, database queries)
- Plan for v0.2 vector search

### If you need real-time
- Poll the API periodically
- Plan for v0.2 WebSocket support

### If you need encryption
- Use database encryption at rest (Neon default)
- Plan for v0.2 app-level encryption

## Security trade-offs

### Intentional trade-offs in v0.1

1. **No encryption in transit**: Uses HTTPS (Vercel default), but no additional encryption
2. **No rate limiting**: Global limits only, not per-token
3. **No audit log viewer**: Events stored but not easily viewable
4. **No backup automation**: Manual export only

### Not security issues

1. **Single user**: By design, not a limitation
2. **Immutability**: Intentional for audit trail
3. **No token expiration**: Tokens are scoped and revocable, expiration is optional

## Known issues

- None currently documented

## Reporting issues

If you encounter unexpected behavior:
1. Check the error message includes consequence + module + cause
2. Review audit events in database
3. Verify token scope and permissions
4. Check environment variables are set correctly
