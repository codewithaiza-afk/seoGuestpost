# LinkForge

LinkForge manages guest-post campaigns, discovers website opportunities, tracks prospects, and sends editor outreach. It supports local development with SQLite and hosted deployment on Vercel with Turso/libSQL.

## Local development

Requirements: Node.js 22 or later and npm.

```sh
npm install
npm run dev
```

By default, the app creates `data/guest-posting.sqlite`, applies migrations, and checks database integrity. Set `DATABASE_PATH` to use another local SQLite file. Local automatic backups are stored beside the database and retained for 30 days.

The local account system stores scrypt password hashes and uses HttpOnly session cookies. Website login and submission assistance that opens a visible browser is a local desktop feature; it cannot open a browser on your device from a Vercel function. On Vercel, use the website's own browser for login and submission, then track the workflow in LinkForge.

## Deploy to Vercel

1. Create a Turso/libSQL database and generate a database authentication token.
2. Import this project into Vercel. Use Node.js 22 and `npm run build`; Nitro's Vercel preset generates the deployment output.
3. Add the environment variables below in Vercel's project settings for Production and Preview as appropriate. Never commit credentials or paste them into chat.
4. Set `APP_BASE_URL` to the deployed HTTPS origin and register `${APP_BASE_URL}/api/gmail/callback` as a redirect URI in the Google OAuth web client.
5. Deploy. The application applies pending Drizzle migrations when its database module starts. You can also apply them explicitly from a trusted local shell with `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` set by running `npm run db:migrate`.

The hosted database is a new database; local SQLite records are not copied automatically. The local backup and restore scripts are for file-based SQLite, not Turso.

| Variable                      | Required                 | Purpose                                                                                        |
| ----------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------- |
| `TURSO_DATABASE_URL`          | Yes on Vercel            | Turso/libSQL database URL, such as `libsql://...`.                                             |
| `TURSO_AUTH_TOKEN`            | Yes on Vercel            | Database access token. Keep it in Vercel environment secrets.                                  |
| `APP_BASE_URL`                | Yes                      | Public HTTPS app origin used for OAuth callbacks and password-reset links.                     |
| `GOOGLE_OAUTH_CLIENT_ID`      | For Gmail reply sync     | Google OAuth web-client ID.                                                                    |
| `GOOGLE_OAUTH_CLIENT_SECRET`  | For Gmail reply sync     | Google OAuth web-client secret.                                                                |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | For Gmail reply sync     | Persistent secret of at least 32 characters used to encrypt stored Gmail refresh tokens.       |
| `GMAIL_USER`                  | For SMTP email           | Sender account for outreach and password-reset email.                                          |
| `GMAIL_APP_PASSWORD`          | For SMTP email           | Google App Password; create a new one and revoke any previously exposed credential.            |
| `CRON_SECRET`                 | For scheduled Gmail sync | Secret used to authorize the scheduled reply-sync endpoint. Vercel sends it as a bearer token. |
| `LOVABLE_API_KEY`             | Optional                 | AI generation and supported email-provider integration.                                        |
| `RESEND_API_KEY`              | Optional                 | Resend API key for supported outbound email.                                                   |
| `RESEND_FROM_EMAIL`           | Optional                 | Verified Resend sender address.                                                                |

Gmail reply synchronization runs daily at 09:00 UTC on Vercel. The schedule is declared in `vercel.json`; local Node development retains its 15-minute polling. Gmail reply access is read-only. LinkForge does not submit articles or publish on third-party sites from Vercel; continue to review and submit through the approved website workflow, and use the existing email outreach fallback where needed.

For Vercel, create a Google Cloud OAuth web client, enable the Gmail API, request the application's configured read-only scope, and register `${APP_BASE_URL}/api/gmail/callback`. Generate a strong `GOOGLE_TOKEN_ENCRYPTION_KEY` locally, then save it as a Vercel secret. Create a new Gmail App Password for `GMAIL_APP_PASSWORD`; revoke an old or exposed one from Google Account security settings. Do not share either secret.

## Local database maintenance

```sh
npm run db:migrate
npm run db:backup
```

Set `DATABASE_PATH` to an absolute path if needed. `DATABASE_BACKUP_DIR` overrides the default sibling backup folder. Remote Turso backups are managed through the database provider.

To restore a local backup, stop the app and run:

```sh
npm run db:restore -- "path/to/guest-posting-YYYY-MM-DD.sqlite" --confirm
```

## Campaign and outreach behavior

Autopilot can send outreach emails to eligible pending prospects. When a free or unpriced guest-post opportunity and editor contact are found, it sends the article draft; when no guest-post page is found, it sends a pitch. Emails ask the editor to publish the article if appropriate or to reply with explicit permission and instructions before LinkForge submits it. The app does not invent contact addresses, submit without explicit approval, or treat an email as publication.
