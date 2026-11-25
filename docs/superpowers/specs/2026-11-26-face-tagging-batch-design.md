# Face tagging: no consent step, a 3-hour batch (short design)

Changes the design in `2026-11-25-face-tagging-design.md`. Approved by Hari on 26 Nov 2026.

## Intent

Face tagging should reach everyone who has put a face on the site, without asking. Opt-in left most people out.
Running the work in one batch every 3 hours means fewer container starts and one notification per person per run.

## What changes

- **Who is matched:** every member who has uploaded their own profile picture (`profile_fields.portraitObject`).
  Their Then/Now photos and the approved yearbook portrait are used as extra reference faces. The yearbook alone
  never makes someone eligible. Members without a profile picture are never matched.
- **No consent step:** the "Find me in batch photos?" card, the profile switch and `POST /faces/consent` are removed.
  Earlier yes/no answers are ignored. The only control left is **Not me** on a photo.
- **Nudge:** members without a profile picture see one line on Home: "Add a profile picture to be found in batch
  photos", linking to their profile.
- **No instant work:** posting a memory and saving a profile photo no longer queue anything. Saving a profile photo
  only marks the member's references as needing a rebuild.
- **The batch** (cron `17 */3 * * *`) queues, through the existing queue:
  1. photos not yet scanned (and failed ones, as before), up to 500;
  2. reference rebuilds for eligible members who are new or whose profile photos changed, up to 100;
  3. one `finish` job, delayed 40 minutes, which re-matches every member whose references were rebuilt in the last
     6 hours against all stored faces and then sends the notifications.
  It also removes automatic tags, matches and references of anyone no longer eligible.
- **Notifications:** one "We found you in N photos" per person per run, never one per photo. Nothing is sent for
  your own uploads.

## Approaches considered

- **Cron queues work, a delayed finish job re-matches and notifies** (chosen): keeps the queue's retries, limits and
  the two-container spread; the finish job closes the gap where a new photo and a new profile picture are processed at
  the same moment and miss each other.
- **The cron does all the work itself:** loses retries and can hit the scheduled Worker's time limit on a backlog.

## Calls made by Claude (not asked of Hari)

- No database migration. `face_prefs` keeps one row per member as the rebuild marker: `ref_tried IS NULL` means "rebuild
  needed"; `recognise` and `decided` are no longer read.
- The admin page's "Members who said yes" becomes "Members with a profile picture".
- Shadow / on / off modes and the Publish button stay as they are.
