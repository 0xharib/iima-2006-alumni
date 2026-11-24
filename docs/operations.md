# Operations and data handling

The application runs as a Cloudflare Worker. D1 holds roster and app records. R2 holds original photos and cached responsive thumbnails. The Worker checks access before serving private media. The Images binding generates thumbnails when available.

## Deployment configuration

Cloudflare’s Git integration deploys main with the production `wrangler.toml`. For local commands use `--config wrangler.local.toml`. Use a separate configuration for any other hosted environment. Fill in its own D1 database, R2 bucket, and application origin. Configure `MAIL_FROM` and `SITE_ORIGIN` for the intended environment and supply `RESEND_API_KEY` as a Worker secret. Keep database exports, member records, photos, local environment files, and credentials out of Git. Use dedicated test addresses and verify the sender domain and its DNS authentication before enabling mail.

`ACCESS_MODE=pilot` restricts entry to invited members and admins. `ACCESS_MODE=batch` lets eligible roster members sign in with the unique address on file. Sending the link to a small group in batch mode limits invitations only.

## Database changes

New local databases can apply the checked-in migrations in order. Existing environments may have had earlier migrations applied directly. Inspect the database and its migration history, back it up, and reconcile applied changes before running the migration runner against a hosted environment.

`0002_publish_imports.sql` is a historical data migration. It creates published profiles and memories from legacy rows and approves pending seeds. Review changes against an isolated copy first if a target contains any unpublished data. Treat legacy submissions and enrichment sources as distinct from owner edits. Profile pages resolve owner edits ahead of published yearbook data and selected enrichment. An explicitly blank owner value hides a fallback.

## Pilot checks

- Request a link to a test address, check Inbox and Junk, open the link once, and confirm that signing out invalidates the session.
- On a phone, check profile and Then / Now uploads, album creation, and a photo mention.
- Confirm that a notification opens the relevant photo or comment, and that only admins can open the admin dashboard and exports.
- Check the reunion form for a confirmed attendee and for an account without a confirmed RSVP.
- Check Admin View coverage and the analytics dashboard. Email acceptance indicates that the provider accepted the send request. Verify inbox placement separately.
