# Owlery MCP

Stdio MCP server for compose-only access to **flows** and **templates**.

Agents can list, get, create, update, and delete. They **cannot** activate/pause flows, enroll contacts, or send/queue email.

## Setup

1. Create a team API key in the Owlery dashboard (Settings → API keys), or via the existing API.
2. Point the MCP process at the same SQLite DB as the app (`DATABASE_URL`).
3. Configure your MCP client:

```json
{
  "mcpServers": {
    "owlery": {
      "command": "npx",
      "args": ["tsx", "mcp/server.ts"],
      "cwd": "/absolute/path/to/owlery",
      "env": {
        "OWLERY_API_KEY": "us_…",
        "OWLERY_DOMAIN_ID": "1",
        "DATABASE_URL": "file:./data/owlery.db",
        "AUTH_SECRET": "same-as-app-or-any-16+-char-secret"
      }
    }
  }
}
```

Or: `npm run mcp` with those env vars set (e.g. in `.env`).

| Env | Required | Notes |
|---|---|---|
| `OWLERY_API_KEY` | yes | Resolves `teamId` (and optional domain from a domain-scoped key) |
| `OWLERY_DOMAIN_ID` | no | Restrict all tools to one domain |
| `DATABASE_URL` | no | Defaults to `file:./data/owlery.db` |

## Tools

**Templates:** `list_templates`, `get_template`, `create_template`, `update_template`, `delete_template`, `compile_template_preview`

**Flows:** `list_flows`, `get_flow`, `create_flow`, `update_flow`, `delete_flow`

- Template source of truth is OwlDoc JSON in `content` (`owl: "v1"`). Prefer editing `content`; `html` is a cached delivery snapshot.
- `compile_template_preview` compiles via the worker-safe OwlDoc→HTML pipeline without persisting or sending.
- `update_flow` does **not** accept `status` — flows stay draft until activated in the dashboard.
