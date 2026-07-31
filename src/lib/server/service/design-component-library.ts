export type StarterDesignComponent = {
	starterKey: string;
	name: string;
	role: string;
	description: string;
	props: string[];
	html: string;
};

export const STARTER_COMPONENT_KEYS = [
	'header',
	'hero',
	'title_text',
	'content',
	'image_block',
	'logo_row',
	'cta',
	'footer',
	'unsubscribe'
] as const;

/**
 * Plain HTML email sections with {{slot}} placeholders.
 * Optional blocks use <!--owl-if:slot-->…<!--/owl-if--> (stripped when slot is empty at compose time).
 */

const HEADER_SOURCE = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f8fafc;" data-owl-section="header">
	<tbody>
		<tr>
			<td align="center" style="padding:24px 16px 12px;">
				<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
					<tbody>
						<tr>
							<td align="left" valign="middle" style="font-family:Arial,sans-serif;font-size:14px;line-height:20px;color:#0f172a;">
								<!--owl-if:logo_url-->
								<a href="{{header_url}}" style="text-decoration:none;display:inline-block;">
									<img src="{{logo_url}}" alt="{{brand_name}}" width="140" style="display:block;max-width:140px;width:100%;height:auto;border:0;" class="logo-light" />
									<!--owl-if:logo_dark_url-->
									<img src="{{logo_dark_url}}" alt="{{brand_name}}" width="140" style="display:none;max-width:140px;width:100%;height:auto;border:0;" class="logo-dark" />
									<!--/owl-if-->
								</a>
								<!--/owl-if-->
								<!--owl-if:brand_name-->
								<strong style="font-size:18px;line-height:24px;">{{brand_name}}</strong>
								<!--/owl-if-->
							</td>
							<td align="right" valign="middle" style="font-family:Arial,sans-serif;font-size:13px;line-height:18px;color:#64748b;">
								{{header_text}}
							</td>
						</tr>
					</tbody>
				</table>
			</td>
		</tr>
	</tbody>
</table>
<style>
	@media (prefers-color-scheme: dark) {
		.logo-light { display: none !important; }
		.logo-dark { display: block !important; }
	}
</style>
`;

const HERO_SOURCE = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f8fafc;" data-owl-section="hero">
	<tbody>
		<tr>
			<td align="center" style="padding:12px 16px 24px;">
				<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border-radius:24px;">
					<tbody>
						<tr>
							<td style="padding:40px 32px 24px;font-family:Arial,sans-serif;color:#0f172a;text-align:left;">
								<!--owl-if:eyebrow-->
								<p style="margin:0 0 12px;font-size:12px;line-height:18px;letter-spacing:0.12em;text-transform:uppercase;color:#6366f1;">{{eyebrow}}</p>
								<!--/owl-if-->
								<h1 style="margin:0 0 16px;font-size:32px;line-height:38px;font-weight:700;">{{headline}}</h1>
								<p style="margin:0 0 24px;font-size:16px;line-height:26px;color:#475569;">{{body}}</p>
								<!--owl-if:primary_cta_label-->
								<table role="presentation" cellpadding="0" cellspacing="0" border="0">
									<tbody>
										<tr>
											<td bgcolor="#4f46e5" style="border-radius:999px;">
												<a href="{{primary_cta_url}}" style="display:inline-block;padding:14px 22px;font-size:14px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;" target="_blank" rel="noopener">{{primary_cta_label}}</a>
											</td>
										</tr>
									</tbody>
								</table>
								<!--/owl-if-->
							</td>
						</tr>
						<!--owl-if:image_url-->
						<tr>
							<td style="padding:0 32px 32px;">
								<img src="{{image_url}}" alt="" style="display:block;width:100%;max-width:536px;height:auto;border:0;border-radius:18px;" />
							</td>
						</tr>
						<!--/owl-if-->
					</tbody>
				</table>
			</td>
		</tr>
	</tbody>
</table>
`;

const TITLE_TEXT_SOURCE = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#ffffff;" data-owl-section="title_text">
	<tbody>
		<tr>
			<td align="center" style="padding:0 16px 24px;">
				<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
					<tbody>
						<tr>
							<td style="padding:0 24px;font-family:Arial,sans-serif;text-align:left;color:#0f172a;">
								<h2 style="margin:0 0 12px;font-size:24px;line-height:32px;font-weight:700;">{{title}}</h2>
								<p style="margin:0;font-size:16px;line-height:26px;color:#475569;">{{body}}</p>
							</td>
						</tr>
					</tbody>
				</table>
			</td>
		</tr>
	</tbody>
</table>
`;

const CONTENT_SOURCE = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#ffffff;" data-owl-section="content">
	<tbody>
		<tr>
			<td align="center" style="padding:0 16px 24px;">
				<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border:1px solid #e2e8f0;border-radius:20px;">
					<tbody>
						<tr>
							<td style="padding:28px 24px;font-family:Arial,sans-serif;text-align:left;color:#0f172a;">
								<h3 style="margin:0 0 12px;font-size:20px;line-height:28px;font-weight:700;">{{title}}</h3>
								<p style="margin:0 0 16px;font-size:15px;line-height:25px;color:#475569;">{{body}}</p>
								<!--owl-if:secondary_cta_label-->
								<a href="{{secondary_cta_url}}" style="font-size:14px;line-height:20px;font-weight:600;color:#4f46e5;text-decoration:none;" target="_blank" rel="noopener">{{secondary_cta_label}} →</a>
								<!--/owl-if-->
							</td>
						</tr>
					</tbody>
				</table>
			</td>
		</tr>
	</tbody>
</table>
`;

const IMAGE_BLOCK_SOURCE = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#ffffff;" data-owl-section="image_block">
	<tbody>
		<tr>
			<td align="center" style="padding:0 16px 24px;">
				<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
					<tbody>
						<!--owl-if:image_url-->
						<tr>
							<td style="padding-bottom:16px;">
								<img src="{{image_url}}" alt="" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:18px;" />
							</td>
						</tr>
						<!--/owl-if-->
						<tr>
							<td style="font-family:Arial,sans-serif;text-align:left;color:#0f172a;padding:0 8px;">
								<h3 style="margin:0 0 10px;font-size:22px;line-height:30px;font-weight:700;">{{title}}</h3>
								<p style="margin:0;font-size:15px;line-height:25px;color:#475569;">{{body}}</p>
							</td>
						</tr>
					</tbody>
				</table>
			</td>
		</tr>
	</tbody>
</table>
`;

const LOGO_ROW_SOURCE = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#ffffff;" data-owl-section="logo_row">
	<tbody>
		<tr>
			<td align="center" style="padding:0 16px 24px;">
				<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border:1px solid #e2e8f0;border-radius:20px;">
					<tbody>
						<tr>
							<td align="center" style="padding:24px;">
								<!--owl-if:logo_url-->
								<img src="{{logo_url}}" alt="Logo" width="120" style="display:block;margin:0 auto 12px;max-width:120px;width:100%;height:auto;border:0;" class="logo-light" />
								<!--owl-if:logo_dark_url-->
								<img src="{{logo_dark_url}}" alt="Logo" width="120" style="display:none;margin:0 auto 12px;max-width:120px;width:100%;height:auto;border:0;" class="logo-dark" />
								<!--/owl-if-->
								<!--/owl-if-->
								<p style="margin:0;font-family:Arial,sans-serif;font-size:14px;line-height:22px;color:#475569;">{{body}}</p>
							</td>
						</tr>
					</tbody>
				</table>
			</td>
		</tr>
	</tbody>
</table>
<style>
	@media (prefers-color-scheme: dark) {
		.logo-light { display: none !important; }
		.logo-dark { display: block !important; }
	}
</style>
`;

const CTA_SOURCE = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f8fafc;" data-owl-section="cta">
	<tbody>
		<tr>
			<td align="center" style="padding:0 16px 24px;">
				<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#0f172a;border-radius:24px;">
					<tbody>
						<tr>
							<td align="center" style="padding:32px 24px;font-family:Arial,sans-serif;color:#ffffff;text-align:center;">
								<h3 style="margin:0 0 10px;font-size:24px;line-height:32px;font-weight:700;color:#ffffff;">{{title}}</h3>
								<p style="margin:0 0 20px;font-size:15px;line-height:24px;color:#cbd5e1;">{{body}}</p>
								<!--owl-if:primary_cta_label-->
								<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
									<tbody>
										<tr>
											<td bgcolor="#ffffff" style="border-radius:999px;">
												<a href="{{primary_cta_url}}" style="display:inline-block;padding:14px 22px;font-size:14px;line-height:20px;font-weight:700;color:#0f172a;text-decoration:none;" target="_blank" rel="noopener">{{primary_cta_label}}</a>
											</td>
										</tr>
									</tbody>
								</table>
								<!--/owl-if-->
							</td>
						</tr>
					</tbody>
				</table>
			</td>
		</tr>
	</tbody>
</table>
`;

const FOOTER_SOURCE = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f8fafc;" data-owl-section="footer">
	<tbody>
		<tr>
			<td align="center" style="padding:8px 16px 24px;">
				<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
					<tbody>
						<tr>
							<td style="padding:24px 8px 0;font-family:Arial,sans-serif;text-align:left;color:#64748b;font-size:13px;line-height:21px;border-top:1px solid #e0dfdd;">
								<p style="margin:0 0 10px;"><strong style="color:#0f172a;">{{brand_name}}</strong></p>
								<p style="margin:0 0 10px;">{{body}}</p>
								<!--owl-if:secondary_cta_label-->
								<p style="margin:0;">
									<a href="{{secondary_cta_url}}" style="color:#475569;text-decoration:underline;" target="_blank" rel="noopener">{{secondary_cta_label}}</a>
								</p>
								<!--/owl-if-->
							</td>
						</tr>
					</tbody>
				</table>
			</td>
		</tr>
	</tbody>
</table>
`;

const UNSUBSCRIBE_SOURCE = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f8fafc;" data-owl-section="unsubscribe">
	<tbody>
		<tr>
			<td align="center" style="padding:0 16px 32px;">
				<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
					<tbody>
						<tr>
							<td align="center" style="font-family:Arial,sans-serif;font-size:12px;line-height:18px;color:#94a3b8;">
								<a href="{{unsubscribe_url}}" style="color:#94a3b8;text-decoration:underline;">{{unsubscribe_label}}</a>
							</td>
						</tr>
					</tbody>
				</table>
			</td>
		</tr>
	</tbody>
</table>
`;

export const STARTER_DESIGN_COMPONENTS: StarterDesignComponent[] = [
	{
		starterKey: 'header',
		name: 'Header',
		role: 'header',
		description: 'Brand header with logo and optional helper text.',
		props: ['logo_url', 'logo_dark_url', 'header_url', 'brand_name', 'header_text'],
		html: HEADER_SOURCE
	},
	{
		starterKey: 'hero',
		name: 'Hero',
		role: 'hero',
		description: 'Main hero section with heading, body copy, CTA, and optional image.',
		props: ['eyebrow', 'headline', 'body', 'primary_cta_label', 'primary_cta_url', 'image_url'],
		html: HERO_SOURCE
	},
	{
		starterKey: 'title_text',
		name: 'TitleText',
		role: 'content',
		description: 'Simple title and paragraph section for standard body copy.',
		props: ['title', 'body'],
		html: TITLE_TEXT_SOURCE
	},
	{
		starterKey: 'content',
		name: 'Content',
		role: 'content',
		description: 'Card-like content block with optional supporting link.',
		props: ['title', 'body', 'secondary_cta_label', 'secondary_cta_url'],
		html: CONTENT_SOURCE
	},
	{
		starterKey: 'image_block',
		name: 'ImageBlock',
		role: 'image',
		description: 'Large image with optional supporting title and body text.',
		props: ['image_url', 'title', 'body'],
		html: IMAGE_BLOCK_SOURCE
	},
	{
		starterKey: 'logo_row',
		name: 'LogoRow',
		role: 'social_proof',
		description: 'Logo-driven supporting section for partner, proof, or brand reinforcement.',
		props: ['logo_url', 'logo_dark_url', 'body'],
		html: LOGO_ROW_SOURCE
	},
	{
		starterKey: 'cta',
		name: 'CTA',
		role: 'cta',
		description: 'High-emphasis conversion section with heading, body, and main CTA.',
		props: ['title', 'body', 'primary_cta_label', 'primary_cta_url'],
		html: CTA_SOURCE
	},
	{
		starterKey: 'footer',
		name: 'Footer',
		role: 'footer',
		description: 'Footer with brand name, supporting copy, and optional secondary link.',
		props: ['brand_name', 'body', 'secondary_cta_label', 'secondary_cta_url'],
		html: FOOTER_SOURCE
	},
	{
		starterKey: 'unsubscribe',
		name: 'Unsubscribe',
		role: 'compliance',
		description: 'Compliance footer row with unsubscribe link.',
		props: ['unsubscribe_url', 'unsubscribe_label'],
		html: UNSUBSCRIBE_SOURCE
	}
];

export function getStarterDesignComponentByKey(starterKey: string): StarterDesignComponent | undefined {
	return STARTER_DESIGN_COMPONENTS.find((component) => component.starterKey === starterKey);
}

export function getStarterDesignComponentByName(name: string): StarterDesignComponent | undefined {
	return STARTER_DESIGN_COMPONENTS.find(
		(component) => component.name.toLowerCase() === name.trim().toLowerCase()
	);
}
