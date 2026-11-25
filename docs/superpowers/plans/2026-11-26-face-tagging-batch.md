# Face tagging batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Match everyone with a profile picture without asking, in one batch every 3 hours.

**Architecture:** Eligibility is a SQL predicate on `profile_fields.portraitObject`, used wherever consent was checked.
The cron queues photo and reference jobs plus one delayed `finish` job that re-matches and notifies.

**Tech Stack:** Cloudflare Workers, D1, Queues, Containers; `node --test`.

**Spec:** docs/superpowers/specs/2026-11-26-face-tagging-batch-design.md

## Global Constraints

- No new migration; `face_prefs.ref_tried IS NULL` marks a rebuild.
- Cron `17 */3 * * *`; photo limit 500, member limit 100 per run; finish job delay 2400 s; re-match window 6 h.
- Nudge copy: "Add a profile picture to be found in batch photos."
- Admin stat label: "Members with a profile picture".

## Review Focus

- A member without a profile picture is never matched, even with a yearbook portrait or an old "yes".
- A member who said "Not now" earlier is matched once they have a profile picture.
- Saving a profile photo through the full profile form (not just inline) marks a rebuild.
- A photo and a new profile picture processed at the same time still end up matched (finish job).
- A member who loses eligibility loses automatic tags but keeps Not me rows and manual tags.

---

### Task 1: Eligibility replaces consent

**Files:** Modify `faces.mjs`, `worker.mjs`, `views.mjs`, `theme.mjs`; Test `test/faces.test.mjs`

**Interfaces:**
- Produces: `ELIGIBLE(col)` SQL fragment; `markRefs(env, member)`; `faceNudge(env, me) -> boolean`.
- Removes: `consentState`, `enqueueRefs`, `FACE_COPY`, `/faces/consent`.

- [ ] Tests: eligible member matched, ineligible (yearbook only / old yes, no picture) not; old "no" row with a picture
      matched; consent route 404; home shows nudge only without a picture; profile shows no switch; both profile save
      paths reset `ref_tried`. Watch them fail.
- [ ] Implement; update existing consent-based tests to set a profile picture instead.
- [ ] Full suite green; commit.

### Task 2: The 3-hour batch

**Files:** Modify `faces.mjs`, `worker.mjs`, `wrangler.toml`, `docs/operations.md`; Test `test/faces.test.mjs`

**Interfaces:**
- `sweep(env, limit=500)` queues media jobs, ref jobs for eligible members needing a rebuild, then a `finish` job
  (`{type:'finish'}`, `delaySeconds: 2400`); cleans up ineligible members.
- `finishRun(env)`: re-match members with `ref_tried` in the last 6 h and refs, then `summarise(env)`.
- `handleQueue`: `ref` jobs only rebuild references; `finish` calls `finishRun`; media jobs never notify per post.
- Posting no longer calls `enqueuePhotos`.

- [ ] Tests: posting queues nothing; sweep queues ref jobs for new/changed eligible members and one delayed finish job;
      finish re-matches and sends one summary; race case covered; ineligible cleanup; cron string is 3-hourly. Fail first.
- [ ] Implement; full suite green; docs; commit.
