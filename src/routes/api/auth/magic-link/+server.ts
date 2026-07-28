import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { env } from '$lib/server/env';
import { createMagicLinkToken } from '$lib/server/auth';
import { parseJson } from '$lib/server/api/validate';
import { sendRawEmail } from '$lib/server/aws/ses';
import { getSetting } from '$lib/server/service/ses-settings-service';
import { getConfigurationSetName } from '$lib/server/service/email-queue-service';

const schema = z.object({ email: z.string().email() });

export const POST: RequestHandler = async ({ request }) => {
	const { email } = await parseJson(request, schema);

	const token = createMagicLinkToken(email);
	const link = `${env.HOST_URL}/api/auth/verify?token=${token}`;

	const setting = getSetting();
	if (env.FROM_EMAIL && setting) {
		try {
			await sendRawEmail({
				to: [email.toLowerCase()],
				from: env.FROM_EMAIL,
				subject: 'Your sign-in link for Owlery',
				html: `<p>Click the link below to sign in to Owlery. This link expires in 15 minutes.</p><p><a href="${link}">Sign in to Owlery</a></p>`,
				text: `Sign in to Owlery: ${link}`,
				region: setting.region,
				configurationSetName: getConfigurationSetName(null, setting) ?? setting.configGeneral ?? ''
			});
		} catch (error) {
			console.error('[magic-link] Failed to send email', error);
		}
	} else {
		console.log(`[magic-link] Sign-in link for ${email}: ${link}`);
	}

	return json({ ok: true });
};
