/**
 * Lightweight email renderer.
 *
 * The editor stores content either as a Tiptap/ProseMirror JSON document
 * (`{ type: "doc", content: [...] }`) or as a raw HTML string. This module
 * turns that content into a final HTML string and replaces `{{variable}}`
 * placeholders. It is intentionally dependency free so it can run on the
 * server without the full jsx-email based editor package.
 */

type JSONContent = {
	type?: string;
	text?: string;
	attrs?: Record<string, unknown>;
	marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
	content?: JSONContent[];
};

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function escapeAttr(value: string): string {
	return escapeHtml(value);
}

function renderMarks(text: string, marks?: JSONContent['marks']): string {
	if (!marks || marks.length === 0) return text;

	return marks.reduce((acc, mark) => {
		switch (mark.type) {
			case 'bold':
				return `<strong>${acc}</strong>`;
			case 'italic':
				return `<em>${acc}</em>`;
			case 'underline':
				return `<u>${acc}</u>`;
			case 'strike':
				return `<s>${acc}</s>`;
			case 'code':
				return `<code>${acc}</code>`;
			case 'link': {
				const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '#';
				return `<a href="${escapeAttr(href)}">${acc}</a>`;
			}
			default:
				return acc;
		}
	}, text);
}

function renderNode(node: JSONContent): string {
	switch (node.type) {
		case 'doc':
			return renderChildren(node);
		case 'text':
			return renderMarks(escapeHtml(node.text ?? ''), node.marks);
		case 'paragraph': {
			const align = typeof node.attrs?.textAlign === 'string' ? node.attrs.textAlign : undefined;
			const style = align ? ` style="text-align:${escapeAttr(align)}"` : '';
			return `<p${style}>${renderChildren(node)}</p>`;
		}
		case 'heading': {
			const level = Number(node.attrs?.level ?? 1);
			const clamped = Math.min(6, Math.max(1, Number.isFinite(level) ? level : 1));
			return `<h${clamped}>${renderChildren(node)}</h${clamped}>`;
		}
		case 'bulletList':
			return `<ul>${renderChildren(node)}</ul>`;
		case 'orderedList':
			return `<ol>${renderChildren(node)}</ol>`;
		case 'listItem':
			return `<li>${renderChildren(node)}</li>`;
		case 'blockquote':
			return `<blockquote>${renderChildren(node)}</blockquote>`;
		case 'codeBlock':
			return `<pre><code>${renderChildren(node)}</code></pre>`;
		case 'horizontalRule':
			return '<hr />';
		case 'hardBreak':
			return '<br />';
		case 'image': {
			const src = typeof node.attrs?.src === 'string' ? node.attrs.src : '';
			const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : '';
			return `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" />`;
		}
		case 'button': {
			const text = typeof node.attrs?.text === 'string' ? node.attrs.text : 'Button';
			const url = typeof node.attrs?.url === 'string' ? node.attrs.url : '#';
			return `<a href="${escapeAttr(url)}" class="owlery-button">${escapeHtml(text)}</a>`;
		}
		default:
			return renderChildren(node);
	}
}

function renderChildren(node: JSONContent): string {
	if (!node.content || node.content.length === 0) return '';
	return node.content.map((child) => renderNode(child)).join('');
}

function replaceVariables(input: string, variables?: Record<string, string>): string {
	if (!variables) return input;
	return Object.keys(variables).reduce((acc, key) => {
		const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
		return acc.replace(regex, variables[key] ?? '');
	}, input);
}

/**
 * Render final email HTML from stored content and/or html, replacing
 * `{{variable}}` placeholders when variables are provided.
 */
export function renderEmailHtml(
	content: string | null,
	html: string | null,
	variables?: Record<string, string>
): string {
	let output = '';

	if (content) {
		try {
			const parsed = JSON.parse(content) as JSONContent;
			if (parsed && (parsed.type === 'doc' || Array.isArray(parsed.content))) {
				output = renderNode(parsed);
			} else {
				output = content;
			}
		} catch {
			// Not JSON, treat content as raw HTML/text.
			output = content;
		}
	}

	if (!output && html) {
		output = html;
	}

	return replaceVariables(output, variables);
}

/**
 * Thin class wrapper mirroring the legacy `EmailRenderer` API for call sites
 * that prefer the object form.
 */
export class EmailRenderer {
	private readonly content: string | null;

	constructor(content: string | Record<string, unknown> | null) {
		this.content = typeof content === 'string' ? content : content ? JSON.stringify(content) : null;
	}

	render(options?: { variableValues?: Record<string, string> }): string {
		return renderEmailHtml(this.content, null, options?.variableValues);
	}
}
