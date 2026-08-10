# Owlery MCP

Compose-only access to **flows** and **templates** (list/get/create/update/delete).
Cannot activate/pause flows, enroll contacts, or send/queue email.

## HTTP endpoint (recommended)

On a running Owlery instance:

```text
https://<your-owlery-host>/mcp
```

Auth: same team API key as the REST API.

```yaml
# ~/.hermes/config.yaml
mcp_servers:
  owlery:
    url: "https://owlery.cerberus.stackstack.de/mcp"
    headers:
      Authorization: "Bearer ${OWLERY_API_KEY}"
```

Put `OWLERY_API_KEY=us_…` in `~/.hermes/.env`, then `/reload-mcp`.

Create the key at **Dev settings → API keys**. Domain-scoped keys limit which domain the agent sees.

## Stdio (local only)

For agents on the same machine as the SQLite DB:

```bash
npm run mcp
# requires OWLERY_API_KEY (+ optional OWLERY_DOMAIN_ID)
```

## Tools

**Templates:** `list_templates`, `get_template`, `create_template`, `update_template`, `delete_template`, `compile_template_preview`

**Flows:** `list_flows`, `get_flow`, `create_flow`, `update_flow`, `delete_flow`
