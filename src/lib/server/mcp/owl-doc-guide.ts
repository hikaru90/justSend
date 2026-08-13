/**
 * Shared OwlDoc guidance for MCP tool descriptions and validation errors.
 * Agents must author templates as this JSON envelope — not MJML, React Email,
 * Handlebars-only blobs, or raw HTML in `content`.
 */
export const OWL_DOC_GUIDE = `OwlDoc (required format for template \`content\`):

\`content\` MUST be a JSON object (or JSON string of that object) with this shape — NOT MJML, NOT React Email, NOT a bare HTML string, NOT email-builder JSON:

{
  "owl": "v1",
  "shell": "<!DOCTYPE html><html><head></head><body>\\n<div data-owl-preheader>…</div>\\n<!--owl:sections-->\\n</body></html>",
  "preheader": "Inbox preview text",
  "sections": [
    {
      "id": "sec_unique_1",
      "key": "body",
      "label": "Body",
      "html": "<table role=\\"presentation\\" width=\\"100%\\" data-owl-role=\\"section\\"><tr><td style=\\"padding:24px;font-family:sans-serif;font-size:16px;color:#111;\\" data-owl-slot=\\"body\\" data-owl-slot-type=\\"text\\">Hello</td></tr></table>"
    }
  ],
  "slotValues": { "body": "Hello {{firstName}}" }
}

Rules:
1. Top-level \`owl\` must be exactly the string "v1".
2. \`shell\` is a full HTML document that MUST contain the comment <!--owl:sections--> (where sections are spliced in). Prefer a \`data-owl-preheader\` element for inbox preview.
3. \`sections\` is an ordered array. Each section needs \`id\` (unique string), \`key\`, \`label\`, and \`html\` (a table fragment with role="presentation", ideally data-owl-role="section").
4. Editable fields use data-owl-slot="name" (+ optional data-owl-slot-type="text"|"image"|"markdown"|"url"). Put values in \`slotValues\` keyed by that name.
5. Recipient merge tags like {{firstName}}, {{email}}, {{lastName}} are allowed inside slot values / subject — they are NOT a separate templating language for the document structure.
6. Do NOT put delivery HTML in \`content\`. Optional \`html\` on create/update is only a cached snapshot; leave it null and use compile_template_preview after save.
7. Workflow: get_template → edit the OwlDoc \`content\` → update_template → compile_template_preview to verify.`;

/** Minimal valid OwlDoc agents can copy when creating from scratch. */
export const OWL_DOC_MINIMAL_EXAMPLE = {
	owl: 'v1' as const,
	shell: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
<div data-owl-preheader style="display:none;max-height:0;overflow:hidden;opacity:0;">Preview</div>
<!--owl:sections-->
</body></html>`,
	preheader: 'Preview',
	sections: [
		{
			id: 'sec_body_1',
			key: 'body',
			label: 'Body',
			html: `<table role="presentation" width="100%" data-owl-role="section"><tr><td style="padding:24px;font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#111111;" data-owl-slot="body" data-owl-slot-type="text">Hello</td></tr></table>`,
		},
	],
	slotValues: { body: 'Hello {{firstName}}' },
};
