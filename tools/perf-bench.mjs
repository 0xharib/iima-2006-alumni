// Synthetic performance bench: counts top-level SQL statements, time and payload per route.
// Uses an in-memory SQLite database with invented classmates only. Never point this at production.
// Usage: node tools/perf-bench.mjs [roster=480] [posts=2000] [runs=15]
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import worker from '../worker.mjs';

const [rosterSize=480, postCount=2000, runs=15] = process.argv.slice(2).map(Number);
const sqlite = new DatabaseSync(':memory:');
const migrations = new URL('../migrations/', import.meta.url);
sqlite.exec(readFileSync(new URL('0000_baseline.sql', migrations), 'utf8'));

// Deterministic pseudo-random numbers so before/after runs see identical data.
let seed = 42;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = n => Math.floor(rand() * n);

sqlite.exec('BEGIN');
const roster = sqlite.prepare('INSERT INTO roster VALUES(?,?,?,?)');
const seeds = sqlite.prepare('INSERT INTO profile_seeds VALUES(?,?,?,?)');
const submissions = sqlite.prepare('INSERT INTO submissions VALUES(?,?,?,?,?,?)');
const photos = sqlite.prepare('INSERT INTO photos VALUES(?,?,?,?)');
for (let i = 1; i <= rosterSize; i++) {
  roster.run(i, 'Synthetic Classmate ' + i, String(1 + (i % 26)), 'Nick' + i);
  seeds.run(i, JSON.stringify({'Life, Lately draft': 'Imported bio ' + i, 'Tracker city': 'City ' + (i % 40)}),
    i % 3 ? 'approved' : 'pending', i % 4 ? null : 'seed-' + i + '.jpg');
  if (i % 5 === 0) {
    submissions.run('self-' + i, i, i, 'self', JSON.stringify({family: 'Family ' + i}), '2026-01-01');
    photos.run('self-' + i, 'legacy-' + i + '.jpg', 'then', 'Then');
  }
}
sqlite.exec('COMMIT');
for (const filename of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) {
  if (filename === '0000_baseline.sql' || filename === '0002_publish_imports.sql') continue;
  sqlite.exec(readFileSync(new URL(filename, migrations), 'utf8'));
}
sqlite.exec('BEGIN');
const members = sqlite.prepare('INSERT OR IGNORE INTO members(id,role,invited) VALUES(?,?,1)');
const field = sqlite.prepare('INSERT OR REPLACE INTO profile_fields VALUES(?,?,?)');
const yearbook = sqlite.prepare('INSERT OR REPLACE INTO yearbook_public VALUES(?,?,?)');
for (let i = 1; i <= rosterSize; i++) {
  members.run(i, i === 1 ? 'admin' : 'member');
  if (i % 5 === 0) yearbook.run(i, JSON.stringify({moment: 'A moment ' + i}), JSON.stringify([{submission: 'self-' + i, key: 'legacy-' + i + '.jpg'}]));
  if (i % 10 < 6 || i <= 2) {
    for (const [key, value] of Object.entries({city: 'City ' + i, life: 'Life lately ' + i, family: 'Family ' + i,
      company: 'Company ' + i, thenPhotoObject: 'profile/then-' + i, nowPhotoObject: 'profile/now-' + i}))
      field.run(i, key, value);
  }
}
const post = sqlite.prepare('INSERT INTO posts(id,author,body,created) VALUES(?,?,?,?)');
const upload = sqlite.prepare('INSERT INTO uploads VALUES(?,?,?,?,?,?,?,?)');
const comment = sqlite.prepare('INSERT INTO comments(id,post,author,body,created) VALUES(?,?,?,?,?)');
const like = sqlite.prepare('INSERT OR IGNORE INTO likes VALUES(?,?)');
const about = sqlite.prepare("INSERT OR IGNORE INTO memory_about VALUES(?,'person',?)");
const base = Date.UTC(2026, 0, 1);
for (let i = 0; i < postCount; i++) {
  const id = 'post-' + String(i).padStart(5, '0');
  post.run(id, 1 + pick(rosterSize), 'Synthetic memory ' + i, base + i * 60000);
  for (let j = 0; j < pick(4); j++) upload.run(id + '-u' + j, 1, 'social/' + id + '-' + j, 'image/jpeg', 'd', '', id, base);
  for (let j = 0; j < pick(4); j++) comment.run(id + '-c' + j, id, 1 + pick(rosterSize), 'Comment ' + j, base + i * 60000 + j);
  for (let j = 0; j < pick(8); j++) like.run(id, 1 + pick(rosterSize));
  if (rand() < 0.4) about.run(id, String(1 + pick(rosterSize)));
}
sqlite.exec('COMMIT');

let statements = 0;
const DB = {
  prepare(query) {
    return {bind(...args) {
      const stmt = sqlite.prepare(query);
      return {
        first: async () => { statements++; return stmt.get(...args) ?? null; },
        all: async () => { statements++; return {results: stmt.all(...args)}; },
        run: async () => { statements++; return stmt.run(...args); },
      };
    }};
  },
  async batch(jobs) {
    sqlite.exec('BEGIN');
    try { const out = []; for (const job of jobs) out.push(await job.run()); sqlite.exec('COMMIT'); return out; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  }
};
const env = {DB, ACCESS_MODE: 'batch', MEDIA: {put: async () => ({}), delete: async () => {}, get: async () => null}};
const raw = 'bbbb';
const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))).toString('hex');
sqlite.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest, 2, Date.now() + 1e9);
const cookie = '__Host-alumni=' + raw;

function request(path, fields, headers = {}) {
  headers.Cookie = cookie;
  const init = fields ? {method: 'POST', headers: {...headers, Origin: 'https://bench.example'}, body: new URLSearchParams(fields)} : {headers};
  return worker.fetch(new Request('https://bench.example' + path, init), env);
}

const json = {Accept: 'application/json'};
const cases = [
  ['GET / (Home)', () => request('/')],
  ['GET /memories', () => request('/memories')],
  ['GET /memories?fragment=1', () => request('/memories?before=' + (base + 1000 * 60000) + '&cursor=post-01000&fragment=1')],
  ['GET /people', () => request('/people')],
  ['GET /people/2', () => request('/people/2')],
  ['GET /profile', () => request('/profile')],
  ['POST /profile full form (redirect)', () => request('/profile', {profile_form: 'all', city: 'City 2', life: 'Life lately 2', family: 'Family 2', company: 'Company 2'})],
  ['POST /profile full form (JSON)', () => request('/profile', {profile_form: 'all', city: 'City 2', life: 'Life lately 2', family: 'Family 2', company: 'Company 2'}, {...json})],
  ['POST /profile attendance (JSON)', () => request('/profile', {field: 'attendance', value: 'attending'}, {...json})],
  ['POST like (JSON)', () => request('/posts/post-01500', {action: 'like', liked: '1'}, {...json})],
  ['GET comments panel', () => request('/posts/post-01500?panel=comments')],
  ['POST comment (JSON)', () => request('/posts/post-01500', {action: 'comment', body: 'Bench comment'}, {...json})],
];
const results = [];
for (const [name, make] of cases) {
  let total = 0, count = 0, bytes = 0, status = 0;
  for (let run = 0; run < runs; run++) {
    statements = 0;
    const started = performance.now();
    const response = await make();
    const text = await response.text();
    total += performance.now() - started;
    count = statements; bytes = Buffer.byteLength(text); status = response.status;
  }
  results.push({name, status, statements: count, ms: +(total / runs).toFixed(2), bytes});
}
// A database-only check: an edit unrelated to completion should not cost completion work.
for (const [name, key] of [['DB: update company (unrelated field)', 'company'], ['DB: update city (completion field)', 'city']]) {
  const stmt = sqlite.prepare('INSERT INTO profile_fields VALUES(?,?,?) ON CONFLICT(member,field) DO UPDATE SET value=excluded.value');
  const started = performance.now();
  for (let run = 0; run < runs; run++) stmt.run(3, key, 'Bench ' + run);
  results.push({name, status: '-', statements: 1, ms: +((performance.now() - started) / runs).toFixed(3), bytes: '-'});
}
console.table(results);
if (process.env.BENCH_JSON) console.log(JSON.stringify(results));
