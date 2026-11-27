// "From the 2006 yearbook": each classmate's printed iimages entry, shown on their profile.
// The owner (or an admin) can hide it; hidden entries and their photos are then served only to the owner and admins.

// Migration 0022 must follow the deploy. Until it has run there is no section and no photo, never an error.
// Only a positive answer is cached, per database binding.
const ready = new WeakSet();
export async function iimagesSchema(db) {
  if (ready.has(db)) return true;
  try { await db.prepare('SELECT hidden FROM iimages_2006 LIMIT 0').bind().all(); } catch { return false; }
  ready.add(db);
  return true;
}

async function row(db, member) {
  if (!await iimagesSchema(db)) return null;
  return db.prepare('SELECT heading,dorm,writeup,photo_key,hidden FROM iimages_2006 WHERE member=?').bind(Number(member)).first();
}
const mayView = (r, member, viewer, isAdmin) => r && (!r.hidden || isAdmin || Number(viewer) === Number(member));

export async function yearbookEntry(db, member, viewer, isAdmin) {
  const r = await row(db, member);
  if (!mayView(r, member, viewer, isAdmin)) return null;
  return {heading: r.heading, dorm: r.dorm, writeup: r.writeup, hasPhoto: !!r.photo_key, hidden: !!r.hidden};
}

export async function yearbookPhotoKey(db, member, viewer, isAdmin) {
  const r = await row(db, member);
  return mayView(r, member, viewer, isAdmin) ? r.photo_key || null : null;
}

export async function setYearbookHidden(db, member, hidden, actor) {
  if (!await iimagesSchema(db)) return;
  await db.prepare('UPDATE iimages_2006 SET hidden=?,hidden_by=?,hidden_at=? WHERE member=?')
    .bind(hidden ? 1 : 0, hidden ? Number(actor) : null, hidden ? Date.now() : null, Number(member)).run();
}
