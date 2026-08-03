/**
 * Email HTML formatting rules for AI generation / editing.
 * Keep in sync with `docs/email-formatting-rules.md`.
 */
export const EMAIL_FORMATTING_RULES = `# Email Formatting Rules

Rules distilled from \`email-example.html\` (Cursor / Customer.io marketing email). Use these when authoring or generating HTML emails.

## Structure

- Wrap the message in a landmark: \`role="article"\`, with \`aria-label\` (subject-like title), \`lang\`, and \`dir="auto"\`.
- Center content in a single column with \`max-width: 620px\` and \`margin-left: auto; margin-right: auto\`.
- Use a near-white page background (\`#fefefe\`) on the outer wrapper and content column.
- Prefer **inline CSS** on every element. Do not rely on external stylesheets or class-based styling for layout/typography that must render in the inbox.
- Keep word wrapping predictable: \`word-break: normal; word-wrap: normal; word-spacing: normal\`.

## Preheader

- Put a short preview sentence in a \`display: none\` block at the top of the body.
- Pad the preheader with invisible filler characters so inbox clients do not pull later body copy into the preview.

## Typography

- Body base: \`font-size: max(16px, 1rem)\`, \`line-height: 1.5\`, \`color: #000000\`.
- Font stack: \`system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif\`.
- Keep paragraphs short (1–3 sentences). Prefer conversational copy over dense blocks.
- Open with a brief greeting, then benefit-focused paragraphs, then one punchy closing line before the CTA.
- Reset paragraph margins (\`margin: 0\`) and control vertical rhythm with spacers instead.

## Spacing

- Do not stack large CSS margins on paragraphs. Use dedicated spacer elements between sections:

  \`\`\`html
  <div style="overflow:auto">
    <div
      style="line-height:1;height:1em;font-size:16px;overflow:hidden"
      aria-hidden="true"
    > </div>
  </div>
  \`\`\`

- Typical spacer sizes from the example:
  - ~21px after the hero image
  - ~16px between body paragraphs
  - ~32px before the primary CTA
  - ~52px before the footer divider
- Horizontal content padding: about \`13px\` sides; body section top padding around \`21px\`.

## Header / Logo

- Place the brand logo at the top, left-aligned.
- Logo link: \`text-decoration: none; display: inline-block\`.
- Give logos an explicit \`width\` (example: ~93px header, ~42px footer).
- Always include meaningful \`alt\` text.
- If supporting dark/light inboxes, provide logo variants and toggle with \`display: none\` / \`display: block\` rather than relying on CSS filters alone.

## Images

- Hero/product images: \`max-width: 100%\`, \`vertical-align: middle\`, descriptive \`alt\`.
- Soft corners are fine: \`border-radius: 8px\`.
- Keep images inside the 620px column so they scale on mobile.
- Prefer one dominant visual above the copy, not a collage of competing images.

## Primary CTA

- One clear primary action (example: “Download the app”).
- Render as an \`<a>\` button (not \`<button>\` / form controls):
  - Outer link: \`display: inline-block\`, \`text-decoration: none\`, \`text-align: center\`
  - Colors: dark fill (\`#000000\`) + light text (\`#faf9f7\`) — or brand primary from design.md when provided
  - Border: \`1px solid #faf9f7\`, \`border-radius: 8px\`
  - Inner padding via a block \`<span>\`: \`padding: 11px 18px; display: block\`
  - \`font-weight: 400\` (not heavy bold)
- Left-align the CTA with the copy (do not force center unless the layout needs it).
- Use \`target="_blank"\` on outbound links.

## Footer

- Separate content from footer with a hairline rule: \`border-top: 1px solid #e0dfdd\` (no heavy box styling).
- Footer text is muted (\`#6f6e6a\`) at \`14px\`, same system font stack.
- Optional small faded brand mark (\`opacity: 0.5\`) above footer links.
- Secondary links in one row, separated by middots (\`·\`), underlined, same muted color.
- Include copyright, location, and a clear **Unsubscribe** link.
- Leave generous bottom breathing room (example: ~72px under unsubscribe).

## Links

- Body/footer text links: \`font-weight: 400\` and \`text-decoration: underline\`.
- Match link color to surrounding text in muted areas so the footer stays quiet.
- Logo and CTA links should not show underlines.

## Tracking & hygiene

- If using an open-tracking pixel, keep it 1×1 and visually hidden (\`display: none !important\` plus max width/height 1px).
- Empty \`alt\` on tracking images.
- Avoid scripts, forms, inputs, flex/grid as the primary layout model, and absolute positioning for core layout.
- Favor email-safe building blocks (inline styles, simple block flow / tables when generating production templates).

## Composition checklist

1. Hidden preheader
2. Logo header
3. One hero image
4. Short greeting + 2–3 body paragraphs + punch line
5. Single primary CTA
6. Divider → muted footer links → legal → unsubscribe
`;
