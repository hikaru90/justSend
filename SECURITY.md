# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public GitHub issue.

Use [GitHub Security Advisories](https://github.com/hikaru90/owlery/security/advisories/new) to submit a confidential report. We will acknowledge receipt and work with you on a fix and coordinated disclosure timeline.

## Sensitive surface

Owlery handles data that requires careful treatment:

- **AWS credentials** — SES/SNS/STS keys stored in environment or team settings
- **Email content** — message bodies, templates, and delivery metadata
- **Contact PII** — subscriber lists, names, and email addresses
- **Session tokens** — `AUTH_SECRET`-signed sessions and API keys (`us_…`)

When reporting, describe impact and reproduction steps without attaching real credentials, production email content, or live contact data.

## Supported versions

Security fixes are applied to the latest release on the `main` branch. Older tags may not receive backports unless explicitly noted in a security advisory.
