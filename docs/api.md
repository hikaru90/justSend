# REST API reference (`/api/v1`)

Programmatic access to transactional email, contacts, campaigns, and analytics.

## Authentication

Create API keys in the dashboard under **Dev Settings → API Keys**. Tokens look like:

```
us_<clientId>_<secret>
```

Send on every request:

```
Authorization: Bearer us_abc123xyz0_0123456789abcdef0123456789abcdef
```

Keys are hashed at rest. Permissions: `FULL` or `SENDING`. Keys may optionally be bound to a single domain (affects analytics scoping).

Unauthenticated or invalid keys return **401**.

## Base URL

All v1 routes are under:

```
{HOST_URL}/api/v1
```

Example base: `https://mail.example.com/api/v1`

## Idempotency

`POST /emails` accepts an optional header:

```
Idempotency-Key: my-unique-key-123
```

Repeating the same key for the same team returns the cached `{ id, status }` response without sending again.

## Errors

Validation and business errors return JSON:

```json
{ "error": { "message": "...", "code": "ERROR" } }
```

---

## Emails

### Send email

`POST /api/v1/emails`

```sh
curl -X POST "$HOST/api/v1/emails" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-12345" \
  -d '{
    "to": "user@example.com",
    "from": "hello@yourdomain.com",
    "subject": "Welcome",
    "html": "<p>Hello!</p>",
    "text": "Hello!",
    "scheduledAt": "2026-08-04T10:00:00.000Z",
    "templateId": "clxyz...",
    "variables": { "name": "Alex" },
    "replyTo": "support@yourdomain.com",
    "cc": ["manager@example.com"],
    "bcc": ["archive@example.com"],
    "headers": { "X-Custom": "value" },
    "attachments": [{ "filename": "doc.pdf", "content": "<base64>" }]
  }'
```

Response:

```json
{ "id": "clxyz...", "status": "QUEUED" }
```

`to`, `cc`, `bcc`, and `replyTo` accept a string or array of strings.

### Batch send

`POST /api/v1/emails/batch`

```sh
curl -X POST "$HOST/api/v1/emails/batch" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "emails": [
      {
        "to": "a@example.com",
        "from": "hello@yourdomain.com",
        "subject": "Hi A",
        "html": "<p>A</p>"
      },
      {
        "to": "b@example.com",
        "from": "hello@yourdomain.com",
        "subject": "Hi B",
        "html": "<p>B</p>"
      }
    ]
  }'
```

Response:

```json
{
  "data": [
    { "id": "...", "status": "QUEUED" },
    { "error": "Suppressed recipient" }
  ]
}
```

Per-message failures do not abort the batch.

### List emails

`GET /api/v1/emails?limit=50&cursor=<cursor>`

```sh
curl "$HOST/api/v1/emails?limit=20" \
  -H "Authorization: Bearer $API_KEY"
```

Response:

```json
{
  "data": [ { "...": "serialized email" } ],
  "nextCursor": "..." 
}
```

Omit `cursor` on first page; pass `nextCursor` for subsequent pages.

### Get email

`GET /api/v1/emails/{emailId}`

```sh
curl "$HOST/api/v1/emails/clxyz..." \
  -H "Authorization: Bearer $API_KEY"
```

### Reschedule email

`PATCH /api/v1/emails/{emailId}`

```sh
curl -X PATCH "$HOST/api/v1/emails/clxyz..." \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "scheduledAt": "2026-08-05T12:00:00.000Z" }'
```

### Cancel email

`POST /api/v1/emails/{emailId}/cancel`

```sh
curl -X POST "$HOST/api/v1/emails/clxyz.../cancel" \
  -H "Authorization: Bearer $API_KEY"
```

Cancels queued or scheduled messages.

---

## Domains

### List domains

`GET /api/v1/domains`

```sh
curl "$HOST/api/v1/domains" \
  -H "Authorization: Bearer $API_KEY"
```

### Create domain

`POST /api/v1/domains`

```sh
curl -X POST "$HOST/api/v1/domains" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "yourdomain.com",
    "region": "us-east-1"
  }'
```

`region` defaults to `AWS_DEFAULT_REGION`.

### Get domain

`GET /api/v1/domains/{id}`

```sh
curl "$HOST/api/v1/domains/1" \
  -H "Authorization: Bearer $API_KEY"
```

### Delete domain

`DELETE /api/v1/domains/{id}`

```sh
curl -X DELETE "$HOST/api/v1/domains/1" \
  -H "Authorization: Bearer $API_KEY"
```

### Verify domain

`POST /api/v1/domains/{id}/verify`

Refreshes DKIM/verification status from SES.

```sh
curl -X POST "$HOST/api/v1/domains/1/verify" \
  -H "Authorization: Bearer $API_KEY"
```

---

## Contact books

### List contact books

`GET /api/v1/contactBooks?search=newsletter`

```sh
curl "$HOST/api/v1/contactBooks" \
  -H "Authorization: Bearer $API_KEY"
```

### Create contact book

`POST /api/v1/contactBooks`

```sh
curl -X POST "$HOST/api/v1/contactBooks" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Newsletter",
    "emoji": "📬",
    "variables": ["firstName", "company"]
  }'
```

### Get contact book

`GET /api/v1/contactBooks/{id}`

### Update contact book

`PATCH /api/v1/contactBooks/{id}`

```sh
curl -X PATCH "$HOST/api/v1/contactBooks/clxyz..." \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Product updates",
    "doubleOptInEnabled": true,
    "doubleOptInSubject": "Confirm your subscription"
  }'
```

### Delete contact book

`DELETE /api/v1/contactBooks/{id}`

---

## Contacts

Nested under a contact book: `/api/v1/contactBooks/{id}/contacts`

### List contacts

`GET /api/v1/contactBooks/{id}/contacts?search=&subscribed=true&limit=50&cursor=`

```sh
curl "$HOST/api/v1/contactBooks/clxyz.../contacts?subscribed=true&limit=100" \
  -H "Authorization: Bearer $API_KEY"
```

### Add or upsert contact

`POST /api/v1/contactBooks/{id}/contacts`

```sh
curl -X POST "$HOST/api/v1/contactBooks/clxyz.../contacts" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "firstName": "Alex",
    "lastName": "B",
    "subscribed": true,
    "properties": { "plan": "pro" }
  }'
```

Response: `{ "contactId": "..." }`

### Get contact

`GET /api/v1/contactBooks/{id}/contacts/{contactId}`

### Update contact

`PATCH /api/v1/contactBooks/{id}/contacts/{contactId}`

### Replace contact (upsert)

`PUT /api/v1/contactBooks/{id}/contacts/{contactId}`

### Delete contact

`DELETE /api/v1/contactBooks/{id}/contacts/{contactId}`

### Bulk add contacts

`POST /api/v1/contactBooks/{id}/contacts/bulk` (max 1000 per request)

```sh
curl -X POST "$HOST/api/v1/contactBooks/clxyz.../contacts/bulk" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contacts": [
      { "email": "a@example.com", "firstName": "A" },
      { "email": "b@example.com", "firstName": "B" }
    ]
  }'
```

Bulk adds are queued for background processing.

### Bulk delete contacts

`DELETE /api/v1/contactBooks/{id}/contacts/bulk`

By contact IDs:

```sh
curl -X DELETE "$HOST/api/v1/contactBooks/clxyz.../contacts/bulk" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "contactIds": ["id1", "id2"] }'
```

Or by email addresses:

```sh
curl -X DELETE "$HOST/api/v1/contactBooks/clxyz.../contacts/bulk" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "emails": ["a@example.com", "b@example.com"] }'
```

---

## Campaigns

### List campaigns

`GET /api/v1/campaigns?limit=50&cursor=`

```sh
curl "$HOST/api/v1/campaigns" \
  -H "Authorization: Bearer $API_KEY"
```

### Create campaign

`POST /api/v1/campaigns`

Provide either `content` (editor JSON) or `html`. Optionally schedule on create with `sendNow` or `scheduledAt`.

```sh
curl -X POST "$HOST/api/v1/campaigns" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "August newsletter",
    "from": "news@yourdomain.com",
    "subject": "What we shipped",
    "previewText": "A quick roundup",
    "contactBookId": "clxyz...",
    "html": "<h1>Hello</h1>",
    "batchSize": 100,
    "scheduledAt": "2026-08-10T09:00:00.000Z"
  }'
```

Use `"sendNow": true` to schedule immediately.

### Get campaign

`GET /api/v1/campaigns/{id}`

### Delete campaign

`DELETE /api/v1/campaigns/{id}`

### Schedule campaign

`POST /api/v1/campaigns/{id}/schedule`

```sh
curl -X POST "$HOST/api/v1/campaigns/clxyz.../schedule" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "scheduledAt": "2026-08-10T09:00:00.000Z",
    "batchSize": 200
  }'
```

Omit `scheduledAt` to schedule for immediate sending.

### Pause campaign

`POST /api/v1/campaigns/{id}/pause`

```sh
curl -X POST "$HOST/api/v1/campaigns/clxyz.../pause" \
  -H "Authorization: Bearer $API_KEY"
```

### Resume campaign

`POST /api/v1/campaigns/{id}/resume`

```sh
curl -X POST "$HOST/api/v1/campaigns/clxyz.../resume" \
  -H "Authorization: Bearer $API_KEY"
```

---

## Analytics

### Email time series

`GET /api/v1/analytics/email-time-series?days=7|30&domainId=`

Daily send/delivery/open/click/bounce counts.

```sh
curl "$HOST/api/v1/analytics/email-time-series?days=30&domainId=1" \
  -H "Authorization: Bearer $API_KEY"
```

`days` defaults to 30 if omitted or invalid. If the API key is domain-scoped, `domainId` is inferred from the key.

Response shape:

```json
{
  "result": [
    { "date": "2026-08-01", "sent": 10, "delivered": 9, "...": "..." }
  ],
  "totalCounts": { "sent": 100, "delivered": 95, "...": "..." }
}
```

### Reputation metrics

`GET /api/v1/analytics/reputation-metrics?domainId=`

Aggregated delivered, hard-bounced, and complained counts with bounce/complaint rates.

```sh
curl "$HOST/api/v1/analytics/reputation-metrics" \
  -H "Authorization: Bearer $API_KEY"
```

Response:

```json
{
  "delivered": 1000,
  "hardBounced": 5,
  "complained": 1,
  "bounceRate": 0.5,
  "complaintRate": 0.1
}
```

---

## Source of truth

Route handlers and Zod schemas live under [`src/routes/api/v1/`](../src/routes/api/v1/). Read those files for exact field validation, enums, and response shapes.

**OpenAPI** generation is a later stretch goal — this document is the hand-maintained reference for now.

## Related

- [Deployment](./deployment.md) — SES/SNS, `HOST_URL`, API key creation
- [Features](./features.md) — full product capability map
- [Architecture](./architecture.md) — queue, multi-tenancy, API auth internals
