# IIMA Class of 2006 Alumni Site

Cloudflare Worker backed by D1 and a private R2 bucket. The application uses the migrated roster, contacts, submissions, photos and profile seeds in place. The social migration adds tables without altering those source tables.

## Run the tests

Use Node.js 24 and run `node --test`. Tests use an isolated SQLite database and in-memory photo store.

## Configure the pilot

Use isolated D1/R2 bindings and a test roster to rehearse the migration and sign-in. Import the existing baseline schema before applying `migrations/0001_social.sql`. The repository does not include alumni records or media.

For the live pilot, configure the intended Worker bindings in `wrangler.toml`, set `SITE_ORIGIN` to the Worker URL, set `LEGACY_YEARBOOK_URL` to the current collection URL and add the `RESEND_API_KEY` secret. Verify the sender domain in Resend. Apply the additive migration against the chosen pilot database after confirming the target. Give a verified roster member the initial admin role through D1:

```sql
INSERT INTO members(id,role,invited) VALUES (<roster_id>,'admin',1)
ON CONFLICT(id) DO UPDATE SET role='admin',invited=1;
```

Use Admin to authorize the pilot roster and preview the reunion tracker RSVP import. The accepted input is `roster_id,status` with explicit `attending`, `declined` or `unknown` values. Signed-in pilot members can flag draft profile content. Confirm the four identity holds and R2 portrait availability against the migration inventory.

## Batch release

Switch `ACCESS_MODE` to `batch` only when opening access to the batch. Test verified email delivery, photo uploads on actual phones, profile media permissions, and the legacy reconciliation first. `INTAKE_ENABLED=true` enables the new verified intake. The existing reminder sender, scheduled reminders and legacy redirects require cutover configuration and reconciliation. Admin currently exports submissions, photo references and pending contacts as JSON.
