# IIMA Class of 2006 Alumni Site

A private-by-sign-in alumni website for the [IIMA Class of 2006 reunion](https://iima-class-of-2006.in). The source is public. Classmate profiles, photo uploads, reunion logistics, and admin activity are stored separately from this repository.

## What it does

- **Sign-in** sends a one-time email link to the address on the alumni roster.
- **Classmates and profiles** combine roster facts, selected enrichment, published yearbook entries, and owner edits. Owners can update their details and add Then / Now photos.
- **Memories** supports text, photos, and albums, with likes, comments, classmate mentions, and topic tags. Photos and albums can be tagged separately.
- **Reunion** shows confirmed attendees the agenda and editable logistics. Admins can see missing details and export attendee information.
- **Notifications** shows in-app activity for mentions, likes, comments, and tags, with previews and links to the relevant memory.
- **Admin View** shows submission, photo, and enrichment coverage, attendee logistics, moderation tools, and site analytics.

## Run the tests

Use Node.js 24 or later.

```sh
node --test
```

Tests use synthetic classmates, an isolated in-memory SQLite database, and an in-memory photo store. They do not send email or contact production.

## Run locally

Use `wrangler.local.toml` for local development. The default `wrangler.toml` targets production and is used by Cloudflare’s Git integration. Apply the schema and load the synthetic roster, then start the Worker.

```sh
npx wrangler d1 migrations apply DB --config wrangler.local.toml --local
npx wrangler d1 execute DB --config wrangler.local.toml --local --file fixtures/demo.sql
npx wrangler dev --config wrangler.local.toml
```

Open the URL Wrangler prints. Requesting a real sign-in email requires separate mail configuration. The automated suite exercises sign-in, albums, notifications, reunion details, and admin permissions with synthetic data.

The Worker reads campus illustrations from R2 under `campus-design-v1/`. To see them in local development, load the checked-in assets into the local bucket before starting the Worker.

```sh
for file in assets/*; do
  npx wrangler r2 object put "iima-2006-alumni-local/campus-design-v1/$(basename "$file")" --config wrangler.local.toml --local --file "$file"
done
```

## Code and operations

| File | Role |
| --- | --- |
| `worker.mjs` | Routing, authentication, data access, photo delivery and administration |
| `views.mjs`, `theme.mjs`, `social.mjs` | Server-rendered pages, CSS and browser interactions |
| `theme.mjs` tokens | The Kahn design system: brick, lime, concrete and night colours, radii and type tokens, plus the final style layer |
| `fonts.mjs` | Self-hosted fonts (SIL Open Font License), served from `/fonts/`: Source Serif 4 with optical sizes, Source Sans 3, IBM Plex Mono, and Tiro Devanagari Sanskrit subset to the motto. Rebuild with `tools/build-fonts.py` |
| `reunion.mjs` | Agenda, attendee detail validation and completeness rules |
| `migrations/` | D1 schema and historical import migrations |
| `test/worker.test.mjs` | Worker integration tests using synthetic data |

See [operations and data handling](docs/operations.md) for bindings, migration precautions, and pilot checks.
