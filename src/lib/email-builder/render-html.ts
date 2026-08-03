/**
 * Table-based email HTML renderer for TEditorConfiguration documents.
 * Plain TypeScript + marked for Text markdown — no third-party email SDK.
 */
import { marked } from 'marked';
import { fluidifyEmailHtml } from '$lib/email/fluidify-email-html';
import type { TEditorBlock, TEditorConfiguration, Padding } from './types';

type BlockStyle = {
	backgroundColor?: string | null;
	borderColor?: string | null;
	borderRadius?: number | null;
	padding?: Padding | null;
	backgroundImage?: string | null;
	backgroundSize?: 'cover' | 'contain' | null;
	backgroundPosition?: string | null;
	backgroundRepeat?: 'no-repeat' | 'repeat' | null;
	minHeight?: number | null;
	overlayColor?: string | null;
	textAlign?: 'left' | 'center' | 'right' | null;
	contentAlignment?: 'top' | 'middle' | 'bottom' | null;
	color?: string | null;
	fontSize?: number | null;
	fontWeight?: string | null;
};

marked.setOptions({ gfm: true, breaks: false });

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function escapeAttr(value: string): string {
	return escapeHtml(value).replace(/'/g, '&#39;');
}

function fontFamilyCss(name: string | undefined): string {
	switch (name) {
		case 'BOOK_SANS':
			return 'Optima, Candara, "Noto Sans", source-sans-pro, sans-serif';
		case 'MODERN_SERIF':
			return 'Charter, "Bitstream Charter", "Sitka Text", Cambria, serif';
		case 'MONOSPACE':
			return '"Nimbus Mono PS", "Courier New", monospace';
		default:
			return '"Helvetica Neue", "Arial Nova", Arial, sans-serif';
	}
}

function paddingCss(padding: Padding | null | undefined): string {
	if (!padding) return '';
	return `padding:${padding.top ?? 0}px ${padding.right ?? 0}px ${padding.bottom ?? 0}px ${padding.left ?? 0}px;`;
}

function childrenIds(block: TEditorBlock | undefined): string[] {
	if (!block) return [];
	if (block.type === 'EmailLayout') return block.data.childrenIds ?? [];
	const props = block.data.props as { childrenIds?: string[] } | undefined;
	return props?.childrenIds ?? [];
}

function styleOf(block: TEditorBlock): BlockStyle {
	return (block.data.style as BlockStyle | undefined) ?? {};
}

function renderChildren(document: TEditorConfiguration, ids: string[]): string {
	return ids.map((id) => renderBlock(document, id)).join('');
}

function renderMarkdown(text: string): string {
	const html = marked.parse(text, { async: false }) as string;
	return html.trim();
}

function renderHeading(block: TEditorBlock): string {
	const props = (block.data.props ?? {}) as { text?: string; level?: string };
	const style = styleOf(block);
	const level = props.level === 'h1' ? 1 : props.level === 'h3' ? 3 : 2;
	const tag = `h${level}` as 'h1' | 'h2' | 'h3';
	const fontSize = style.fontSize ?? (level === 1 ? 32 : level === 3 ? 20 : 24);
	const align = style.textAlign ?? 'left';
	const color = style.color ?? 'inherit';
	const weight = style.fontWeight ?? 'bold';
	const text = props.text ?? '';
	return `<div style="${paddingCss(style.padding)}text-align:${align};">
<${tag} style="margin:0;font-weight:${escapeAttr(String(weight))};font-size:${fontSize}px;color:${escapeAttr(String(color))};line-height:1.25;">${escapeHtml(text)}</${tag}>
</div>`;
}

function renderText(block: TEditorBlock): string {
	const props = (block.data.props ?? {}) as { text?: string; markdown?: boolean };
	const style = styleOf(block);
	const align = style.textAlign ?? 'left';
	const color = style.color ?? 'inherit';
	const fontSize = style.fontSize ?? 16;
	const weight = style.fontWeight ?? 'normal';
	const raw = props.text ?? '';
	const body =
		props.markdown === false ? escapeHtml(raw).replace(/\n/g, '<br />') : renderMarkdown(raw);
	return `<div style="${paddingCss(style.padding)}text-align:${align};color:${escapeAttr(String(color))};font-size:${fontSize}px;font-weight:${escapeAttr(String(weight))};line-height:1.5;">${body}</div>`;
}

function renderButton(block: TEditorBlock): string {
	const props = (block.data.props ?? {}) as {
		text?: string;
		url?: string;
		buttonBackgroundColor?: string;
		buttonTextColor?: string;
	};
	const style = styleOf(block);
	const align = style.textAlign ?? 'left';
	const bg = props.buttonBackgroundColor ?? '#000000';
	const fg = props.buttonTextColor ?? '#FFFFFF';
	const text = props.text ?? 'Button';
	const url = props.url ?? '#';
	return `<div style="${paddingCss(style.padding)}text-align:${align};">
<a href="${escapeAttr(url)}" target="_blank" rel="noopener" style="display:inline-block;background-color:${escapeAttr(bg)};color:${escapeAttr(fg)};font-size:14px;font-weight:bold;text-decoration:none;padding:12px 24px;border-radius:4px;line-height:1;">${escapeHtml(text)}</a>
</div>`;
}

function renderImage(block: TEditorBlock): string {
	const props = (block.data.props ?? {}) as {
		url?: string;
		alt?: string;
		width?: number | null;
		linkHref?: string | null;
		contentAlignment?: string;
	};
	const style = styleOf(block);
	const align = style.textAlign ?? 'left';
	const url = props.url ?? '';
	const alt = props.alt ?? '';
	const widthAttr = props.width != null && props.width > 0 ? ` width="${props.width}"` : '';
	const widthStyle =
		props.width != null && props.width > 0 ? `width:${props.width}px;` : 'width:100%;';
	const img = `<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}"${widthAttr} style="${widthStyle}max-width:100%;height:auto;display:block;border:0;outline:none;text-decoration:none;" />`;
	const linked =
		props.linkHref != null && props.linkHref !== ''
			? `<a href="${escapeAttr(props.linkHref)}" target="_blank" rel="noopener" style="text-decoration:none;border:0;">${img}</a>`
			: img;
	// No background-color unless the block style explicitly sets one.
	const bg = style.backgroundColor ? `background-color:${escapeAttr(style.backgroundColor)};` : '';
	return `<div style="${paddingCss(style.padding)}${bg}text-align:${align};">${linked}</div>`;
}

function renderDivider(block: TEditorBlock): string {
	const props = (block.data.props ?? {}) as { lineColor?: string; lineHeight?: number };
	const style = styleOf(block);
	const color = props.lineColor ?? '#CCCCCC';
	const height = props.lineHeight ?? 1;
	return `<div style="${paddingCss(style.padding)}">
<div style="border-top:${height}px solid ${escapeAttr(color)};font-size:1px;line-height:1px;">&nbsp;</div>
</div>`;
}

function renderSpacer(block: TEditorBlock): string {
	const props = (block.data.props ?? {}) as { height?: number };
	const height = props.height ?? 16;
	return `<div style="height:${height}px;line-height:${height}px;font-size:1px;">&nbsp;</div>`;
}

function renderHtml(block: TEditorBlock): string {
	const props = (block.data.props ?? {}) as { contents?: string };
	const style = styleOf(block);
	const fontSize = style.fontSize != null ? `font-size:${style.fontSize}px;` : '';
	const contents = fluidifyEmailHtml(props.contents ?? '');
	return `<div style="${paddingCss(style.padding)}${fontSize}">${contents}</div>`;
}

function renderContainer(document: TEditorConfiguration, block: TEditorBlock): string {
	const style = styleOf(block);
	const kids = renderChildren(document, childrenIds(block));
	const content = style.overlayColor
		? `<div style="background-color:${escapeAttr(style.overlayColor)};width:100%;">${kids}</div>`
		: kids;

	const pad = paddingCss(style.padding);
	const border = style.borderColor ? `border:1px solid ${escapeAttr(style.borderColor)};` : '';
	const radius = style.borderRadius != null ? `border-radius:${style.borderRadius}px;` : '';
	const textAlign = style.textAlign ? `text-align:${style.textAlign};` : '';
	const valign =
		style.contentAlignment === 'middle'
			? 'middle'
			: style.contentAlignment === 'bottom'
				? 'bottom'
				: style.backgroundImage
					? 'middle'
					: 'top';

	if (style.backgroundImage) {
		const url = String(style.backgroundImage).replace(/["'\\]/g, '');
		const size = style.backgroundSize ?? 'cover';
		const position = style.backgroundPosition ?? 'center';
		const repeat = style.backgroundRepeat ?? 'no-repeat';
		const minHeight = style.minHeight ?? 200;
		// Only paint a fill when the author chose one — never default to black (breaks PNGs).
		const bgColor = style.backgroundColor ? escapeAttr(style.backgroundColor) : '';
		const bgColorCss = bgColor ? `background-color:${bgColor};` : '';
		const bgcolorAttr = bgColor ? ` bgcolor="${bgColor}"` : '';
		const vmlColor = bgColor || 'transparent';
		const safeUrl = escapeAttr(url);
		const vmlOpen = `<!--[if gte mso 9]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:600px;height:${minHeight}px;"><v:fill type="frame" src="${safeUrl}" color="${vmlColor}" /><v:textbox inset="0,0,0,0"><![endif]-->`;
		const vmlClose = `<!--[if gte mso 9]></v:textbox></v:rect><![endif]-->`;
		return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
<tr>
<td background="${safeUrl}"${bgcolorAttr} valign="${valign}" height="${minHeight}" style="background-image:url('${safeUrl}');background-size:${size};background-position:${position};background-repeat:${repeat};${bgColorCss}min-height:${minHeight}px;${pad}${border}${radius}${textAlign}">
${vmlOpen}${content}${vmlClose}
</td>
</tr>
</table>`;
	}

	const bg = style.backgroundColor ? `background-color:${escapeAttr(style.backgroundColor)};` : '';
	const minH = style.minHeight != null ? `min-height:${style.minHeight}px;` : '';
	if (style.minHeight != null && valign !== 'top') {
		return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
<tr>
<td valign="${valign}" height="${style.minHeight}" style="${bg}${pad}${border}${radius}${textAlign}${minH}">${content}</td>
</tr>
</table>`;
	}
	return `<div style="${bg}${pad}${border}${radius}${textAlign}${minH}">${content}</div>`;
}

function renderColumns(document: TEditorConfiguration, block: TEditorBlock): string {
	const style = styleOf(block);
	const props = (block.data.props ?? {}) as {
		columns?: Array<{ childrenIds: string[] }>;
		columnsGap?: number;
		contentAlignment?: string;
	};
	const cols = props.columns ?? [];
	const gap = props.columnsGap ?? 16;
	const valign =
		props.contentAlignment === 'middle'
			? 'middle'
			: props.contentAlignment === 'bottom'
				? 'bottom'
				: 'top';
	const bg = style.backgroundColor ? `background-color:${escapeAttr(style.backgroundColor)};` : '';
	const border = style.borderColor ? `border:1px solid ${escapeAttr(style.borderColor)};` : '';
	const radius = style.borderRadius != null ? `border-radius:${style.borderRadius}px;` : '';
	const count = Math.max(cols.length, 1);
	const widthPct = Math.floor(100 / count);
	const cells = cols
		.map((col, i) => {
			const padRight = i < cols.length - 1 ? `padding-right:${gap}px;` : '';
			return `<td class="owl-stack" width="${widthPct}%" valign="${valign}" style="width:${widthPct}%;${padRight}vertical-align:${valign};">${renderChildren(document, col.childrenIds ?? [])}</td>`;
		})
		.join('');
	return `<div style="${paddingCss(style.padding)}${bg}${border}${radius}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
<tr>${cells}</tr>
</table>
</div>`;
}

function renderEmailLayout(document: TEditorConfiguration, block: TEditorBlock): string {
	const backdrop = block.data.backdropColor ?? '#F5F5F5';
	const canvas = block.data.canvasColor ?? '#FFFFFF';
	const textColor = block.data.textColor ?? '#262626';
	const font = fontFamilyCss(block.data.fontFamily);
	const kids = fluidifyEmailHtml(renderChildren(document, childrenIds(block)));
	return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<style type="text/css">
:root{color-scheme:light dark;supported-color-schemes:light dark;}
html,body{margin:0!important;padding:0!important;width:100%!important;}
img{max-width:100%!important;height:auto!important;}
table{border-collapse:collapse;}
.owl-email-pad{padding:32px 12px;}
.logo-dark{display:none!important;max-height:0!important;overflow:hidden!important;}
@media (prefers-color-scheme:dark){
.logo-light{display:none!important;max-height:0!important;overflow:hidden!important;}
.logo-dark{display:inline-block!important;max-height:none!important;overflow:visible!important;}
body,.owl-email-backdrop,td.owl-email-pad{background-color:#111111!important;}
.owl-email-canvas{background-color:#1c1c1c!important;color:#f2f2f2!important;}
}
@media only screen and (max-width:620px){
.owl-email-pad{padding:16px 8px!important;}
.owl-email-canvas{width:100%!important;max-width:100%!important;}
.owl-stack{display:block!important;width:100%!important;max-width:100%!important;}
}
</style>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;width:100%;background-color:${escapeAttr(backdrop)};">
<table role="presentation" class="owl-email-backdrop" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${escapeAttr(backdrop)}" style="width:100%;background-color:${escapeAttr(backdrop)};">
<tr>
<td align="center" class="owl-email-pad" style="padding:32px 12px;background-color:${escapeAttr(backdrop)};">
<table role="presentation" class="owl-email-canvas" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${escapeAttr(canvas)}" style="margin:0 auto;max-width:600px;width:100%;background-color:${escapeAttr(canvas)};color:${escapeAttr(textColor)};font-family:${escapeAttr(font)};font-size:16px;line-height:1.5;">
<tr><td style="width:100%;">${kids}</td></tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;
}

export function renderBlock(document: TEditorConfiguration, blockId: string): string {
	const block = document[blockId];
	if (!block) return '';
	switch (block.type) {
		case 'EmailLayout':
			return renderEmailLayout(document, block);
		case 'Container':
			return renderContainer(document, block);
		case 'ColumnsContainer':
			return renderColumns(document, block);
		case 'Heading':
			return renderHeading(block);
		case 'Text':
			return renderText(block);
		case 'Button':
			return renderButton(block);
		case 'Image':
			return renderImage(block);
		case 'Divider':
			return renderDivider(block);
		case 'Spacer':
			return renderSpacer(block);
		case 'Html':
			return renderHtml(block);
		default:
			return '';
	}
}
