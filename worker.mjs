import { render, signIn, page, form, field } from './views.mjs';

const encoder = new TextEncoder();
const id = () => crypto.randomUUID();
const now = () => Date.now();
const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
  typeof value === 'string' ? encoder.encode(value) : value)), byte => byte.toString(16).padStart(2, '0')).join('');
const cookie = (token, age) => `__Host-alumni=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const redirect = (url, headers = {}) => new Response(null, {status:303, headers:{Location:url,...headers}});
const missing = () => new Response('Page unavailable', {status:404});
const invalid = message => new Response(message, {status:400});
const json = data => Response.json(data);
const destination = value => /^\/(?![\/\\])[^\r\n\\]*$/.test(String(value)) ? String(value) : '/';
const str = (data, key, limit = 4000) => String(data.get(key) ?? '').trim().slice(0,limit);
const profileKeys = ['life','city','company','education','dorm','family','nickname','interests','outsideWork','moment','firstDayAdvice','reunionStory','anythingElse','extra','prompt','printName'];
const attendanceNames = {attending:'Attending',declined:'Not attending',unknown:'No response'};
const parse = value => { try { return JSON.parse(value) ?? {}; } catch { return {}; } };
const encode = encodeURIComponent;

export default {
  async fetch(request, env) {
    try {
      const response = await route(request, env);
      response.headers.set('Cache-Control','private, no-store');
      response.headers.set('X-Content-Type-Options','nosniff');
      response.headers.set('Referrer-Policy','no-referrer');
      response.headers.set('Content-Security-Policy',"default-src 'none'; img-src 'self' https://archives.iima.ac.in; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
      return response;
    } catch (error) { if (env.DIAGNOSTICS === 'true') console.error(error.name, error.message);
      return new Response('The site could not complete that request. Please try again.', {status:500});
    }
  }
};

async function route(req, env) {
  const u = new URL(req.url), path = u.pathname, post = req.method === 'POST';
  const db = env.DB;
  const sql = (query, ...args) => db.prepare(query).bind(...args);
  const one = (query, ...args) => sql(query,...args).first();
  const all = async (query,...args) => (await sql(query,...args).all()).results;
  const run = (query,...args) => sql(query,...args).run();
  const pilot = env.ACCESS_MODE !== 'batch';
  if (post && req.headers.get('Origin') !== u.origin) return new Response('Request denied', {status:403});
  if (!post && req.method !== 'GET') return new Response(null,{status:405});
  const token = req.headers.get('Cookie')?.match(/(?:^|;\s*)__Host-alumni=([a-f0-9-]+)/)?.[1];
  const member = token && await one(`SELECT m.*,r.name FROM sessions s JOIN members m ON m.id=s.member
    JOIN roster r ON r.id=m.id WHERE s.token=? AND s.expires>? AND m.suspended=0 AND (?=0 OR m.invited=1 OR m.role='admin')`,await hash(token),now(),+pilot);
  const show = (title,body) => render(title,body,member);
  const data = () => req.formData();
  const mailHelp = 'mailto:s.tahseen.q@gmail.com,arun.devanathan@gmail.com?subject=IIMA%20Class%20of%202006%20roster%20email&body=Name%3A%0ADorm%20Number%3A%0ADorm%20Name%3A%0ACorrect%20Email%20ID%3A';
  const rosterEmail = key => one(`SELECT email FROM reminder_contacts c WHERE batchmate_id=? AND trim(email)<>'' AND
    (SELECT count(*) FROM reminder_contacts x WHERE lower(trim(x.email))=lower(trim(c.email)))=1`,key);
  const limit = async (key, minutes, maximum) => {
    const window = Math.floor(now()/(minutes*60000));
    const row = await one(`INSERT INTO rate_limits VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET
      hits=CASE WHEN window=excluded.window THEN hits+1 ELSE 1 END,window=excluded.window RETURNING hits`,key,window);
    return row.hits<=maximum;
  };
  if (path === '/picker.js') return new Response(page.pickerScript,{headers:{'Content-Type':'text/javascript; charset=utf-8'}});
  if (path === '/names' && !post) {
    const query = (u.searchParams.get('q') || '').trim().slice(0,80);
    if (query.length < 2) return json([]);
    return json(await all("SELECT id,name FROM roster WHERE instr(lower(name),lower(?))>0 ORDER BY name LIMIT 12",query));
  }
  const intake = env.INTAKE_ENABLED === 'true';
  if (path === '/submit' && !intake && env.LEGACY_YEARBOOK_URL) return redirect(env.LEGACY_YEARBOOK_URL);
  if (path === '/submit' && intake && !post && !member) return redirect('/signin?next=%2Fsubmit');
  if (path === '/signin' || (!member && path === '/')) {
    const key = Number(u.searchParams.get('id'));
    const selected = key && await one('SELECT id,name FROM roster WHERE id=?',key);
    const contact = selected && await rosterEmail(key);
    const [local, domain] = (contact?.email?.trim() || '').split('@');
    const maskedEmail = local && domain ? local.slice(0, Math.max(0, Math.min(3, local.length - 1))) + 'XXX@' + domain : '';
    return signIn({
      selected, maskedEmail, next: destination(u.searchParams.get('next')), mailHelp,
      yearbookUrl: intake ? '/submit' : env.LEGACY_YEARBOOK_URL,
    });
  }
  if (path === '/request-link' && post) {
    const f = await data(), key = Number(f.get('id'));
    if (!Number.isSafeInteger(key) || key<1) return invalid('Choose a classmate.');
    const ok = await limit('ip:'+await hash(req.headers.get('CF-Connecting-IP') || 'local'),30,12);
    const allowed = ok && await limit('mail:'+key,30,3);
    const contact = allowed && await rosterEmail(key);
    if (contact && env.RESEND_API_KEY) {
      const raw = id()+id();
      await run('INSERT INTO login_links VALUES(?,?,?,?)',await hash(raw),key,now()+1200000,destination(f.get('next')));
      const link = new URL('/verify?token='+raw,env.SITE_ORIGIN || u.origin);
      const mail = await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},
        body:JSON.stringify({from:env.MAIL_FROM,to:[contact.email.trim()],subject:'Sign in to IIMA Class of 2006',text:'Open this link within 20 minutes to sign in: '+link.href})});
      if (!mail.ok) return show('Email unavailable','<p>Please try again later or contact the batch admins.</p>');
    }
    if (!env.RESEND_API_KEY) return show('Email unavailable','<p>Sign-in email is being configured.</p>');
    return show('Check your inbox','<p>If the roster address can receive mail, your sign-in link is on its way.</p>');
  }
  if (path === '/verify') {
    if (!post) return show('Confirm sign-in',form('/verify',field('token',u.searchParams.get('token') || ''),'Sign in'));
    const raw = str(await data(),'token',100), digest = await hash(raw);
    const link = await one('DELETE FROM login_links WHERE token=? AND expires>? RETURNING member,destination',digest,now());
    if (!link) return show('Link expired','<p><a href="/signin">Request another link</a></p>');
    await run('INSERT OR IGNORE INTO members(id) VALUES(?)',link.member);
    const account = await one('SELECT * FROM members WHERE id=?',link.member);
    if (account.suspended || (pilot && !account.invited && account.role!=='admin')) return show('Pilot access','<p>This phase is open to invited classmates.</p>');
    const session = id()+id();
    await run('INSERT INTO sessions VALUES(?,?,?)',await hash(session),link.member,now()+30*86400000);
    return redirect(link.destination,{'Set-Cookie':cookie(session,30*86400)});
  }
  if (!member) return redirect('/signin?next='+encode(path+u.search));
  const me = member.id;
  const admin = member.role === 'admin';
  const visibleSeed = "(s.review_status='approved' OR (?=1 AND s.review_status='pending'))";
  const postVisible = 'p.hidden=0 AND (p.topic IS NULL OR EXISTS(SELECT 1 FROM topics t WHERE t.id=p.topic AND t.hidden=0))';
  const postQuery = `SELECT p.*,r.name AS author_name,t.title AS topic_title,
    (SELECT count(*) FROM likes l WHERE l.post=p.id) AS likes,
    (SELECT count(*) FROM likes l WHERE l.post=p.id AND l.member=?) AS liked
    FROM posts p JOIN roster r ON r.id=p.author LEFT JOIN topics t ON t.id=p.topic`;
  async function posts(where = '1', args = [], size = 25) {
    return all(`${postQuery} WHERE ${postVisible} AND (${where}) ORDER BY p.created DESC,p.id DESC LIMIT ?`,me,...args,size);
  }
  async function gallery(person) {
    const seed = `SELECT 'seed/'||s.roster_id AS media,r.name AS caption,'/people/'||r.id AS source,s.portrait_key AS object_key
      FROM profile_seeds s JOIN roster r ON r.id=s.roster_id WHERE ${visibleSeed} AND s.portrait_key IS NOT NULL AND (? IS NULL OR r.id=?)`;
    const yearbook = `SELECT 'yearbook/'||y.member||'/'||j.key AS media,ph.caption,'/people/'||y.member AS source,ph.object_key
      FROM yearbook_public y,json_each(y.images) j JOIN photos ph ON ph.submission=json_extract(j.value,'$.submission')
      AND ph.object_key=json_extract(j.value,'$.key') WHERE (? IS NULL OR y.member=?)`;
    const uploads = `SELECT 'post/'||a.id AS media,a.caption,'/posts/'||p.id AS source,a.object_key
      FROM uploads a JOIN posts p ON p.id=a.post WHERE ${postVisible} AND (? IS NULL OR p.author=? OR
      (p.subject=? AND NOT EXISTS(SELECT 1 FROM muted_subjects m WHERE m.post=p.id)) OR
      EXISTS(SELECT 1 FROM tags t WHERE t.post=p.id AND t.member=? AND t.status='accepted'))`;
    const memories = `SELECT 'legacy/'||p.id||'/'||ROW_NUMBER() OVER(PARTITION BY p.id ORDER BY ph.object_key) AS media,ph.caption,'/posts/'||p.id AS source,ph.object_key
      FROM posts p JOIN photos ph ON ph.submission=p.origin WHERE ${postVisible} AND (? IS NULL OR p.author=? OR
      (p.subject=? AND NOT EXISTS(SELECT 1 FROM muted_subjects m WHERE m.post=p.id)))`;
    const rows = await all(`${seed} UNION ALL ${yearbook} UNION ALL ${uploads} UNION ALL ${memories}`,+pilot,...Array(11).fill(person));
    const seen = new Set();
    return rows.filter(row => {if (seen.has(row.object_key)) return false; seen.add(row.object_key); return true;});
  }
  if (/^\/yearbook-preview\/\d+$/.test(path) && !post) {
    const index = Number(path.split('/').pop());
    const row = await one(`SELECT ph.object_key FROM photos ph WHERE ph.submission=(
      SELECT id FROM submissions WHERE subject=? AND contributor=? AND kind='self' ORDER BY created DESC LIMIT 1)
      ORDER BY slot,object_key LIMIT 1 OFFSET ?`,me,me,index);
    return servePhoto(env,row);
  }
  if (path.startsWith('/media/') && !post) {
    const key = path.slice(7);
    const bits = key.split('/');
    let row;
    if (bits[0]==='post') row = await one(`SELECT a.object_key,a.type FROM uploads a JOIN posts p ON p.id=a.post WHERE a.id=? AND ${postVisible}`,bits[1]);
    else if (bits[0]==='seed') row = await one(`SELECT s.portrait_key AS object_key FROM profile_seeds s WHERE s.roster_id=? AND ${visibleSeed}`,Number(bits[1]),+pilot);
    else if (bits[0]==='yearbook') row = await one(`SELECT ph.object_key FROM yearbook_public y,json_each(y.images) j
      JOIN photos ph ON ph.submission=json_extract(j.value,'$.submission') AND ph.object_key=json_extract(j.value,'$.key')
      WHERE y.member=? AND j.key=?`,Number(bits[1]),Number(bits[2]));
    else if (bits[0]==='legacy' && Number(bits[2])>0) row = await one(`SELECT ph.object_key FROM posts p JOIN photos ph ON ph.submission=p.origin
      WHERE p.id=? AND ${postVisible} ORDER BY ph.object_key LIMIT 1 OFFSET ?`,bits[1],Number(bits[2])-1);
    return servePhoto(env,row);
  }
  if (path==='/logout' && post) {
    await run('DELETE FROM sessions WHERE token=?',await hash(token));
    return redirect('/',{'Set-Cookie':cookie('',0)});
  }
  if (path==='/') {
    const before = Number(u.searchParams.get('before')) || now()+1;
    const cursor = u.searchParams.get('cursor') || '';
    const rows = await posts('p.created<? OR (p.created=? AND p.id<?)',[before,before,cursor]);
    const last = rows.at(-1);
    return show('Twenty years on',page.feed(rows,last && rows.length===25 ? '/?before='+last.created+'&cursor='+encode(last.id):''));
  }
  if (path==='/people' || path==='/reunion') {
    const q = (u.searchParams.get('q')||'').slice(0,100), status = u.searchParams.get('status')||'';
    const rows = await all(`SELECT r.id,r.name,r.dorm,r.nickname,CASE WHEN coalesce(m.attendance_private,0)=0 THEN a.status END AS status
      FROM roster r LEFT JOIN members m ON m.id=r.id LEFT JOIN attendance a ON a.member=r.id
      WHERE instr(lower(r.name||' '||r.nickname||' '||r.dorm),lower(?))>0 AND (?='' OR (coalesce(m.attendance_private,0)=0 AND a.status=?)) ORDER BY r.name`,q,status,status);
    return show(path==='/reunion'?'December reunion':'Classmates',page.directory(rows,attendanceNames,q,status));
  }
  const person = path.match(/^\/people\/(\d+)$/);
  if (person) {
    const key = Number(person[1]);
    const row = await one(`SELECT r.*,CASE WHEN coalesce(m.attendance_private,0)=0 THEN a.status END AS status
      FROM roster r LEFT JOIN members m ON m.id=r.id LEFT JOIN attendance a ON a.member=r.id WHERE r.id=?`,key);
    if (!row) return missing();
    const seed = await one(`SELECT s.source_data FROM profile_seeds s WHERE s.roster_id=? AND ${visibleSeed}`,key,+pilot);
    const imported = parse(seed?.source_data);
    const published = await one('SELECT fields FROM yearbook_public WHERE member=?',key);
    const overrides = Object.fromEntries((await all('SELECT field,value FROM profile_fields WHERE member=?',key)).map(r=>[r.field,r.value]));
    const details = {dorm:row.dorm,nickname:row.nickname,life:imported['Life, Lately draft'],city:imported['Tracker city'],company:imported['Tracker company'],...parse(published?.fields),...overrides};
    return show(row.name,page.person(row,attendanceNames[row.status],details,await gallery(key),
      await posts('p.author=? OR (p.subject=? AND NOT EXISTS(SELECT 1 FROM muted_subjects m WHERE m.post=p.id)) OR EXISTS(SELECT 1 FROM tags t WHERE t.post=p.id AND t.member=? AND t.status=\'accepted\')',[key,key,key]),me,pilot));
  }
  if (path==='/profile') {
    if (!post) {
      const fields = await all('SELECT field,value FROM profile_fields WHERE member=?',me);
      return show('Edit profile',page.editProfile(Object.fromEntries(fields.map(f=>[f.field,f.value])),member));
    }
    const f = await data();
    const jobs = ['life','city','company','education','dorm','family','nickname'].map(key => {
      if (f.has('hide_'+key)) return sql('INSERT OR REPLACE INTO profile_fields VALUES(?,?,?)',me,key,'');
      const value = str(f,key);
      return value ? sql('INSERT OR REPLACE INTO profile_fields VALUES(?,?,?)',me,key,value) : sql('DELETE FROM profile_fields WHERE member=? AND field=?',me,key);
    });
    jobs.push(sql('UPDATE members SET attendance_private=? WHERE id=?',+f.has('attendance_private'),me));
    await db.batch(jobs);
    return redirect('/people/'+me);
  }
  if (path==='/submit' && intake) {
    const last = await one("SELECT id,payload FROM submissions WHERE subject=? AND contributor=? AND kind='self' ORDER BY created DESC LIMIT 1",me,me);
    if (!post) return show('Submit your yearbook entry',page.intake(
      await all('SELECT id,name FROM roster ORDER BY name'),me,parse(last?.payload),profileKeys));
    if (!await limit('intake:'+me,30,10)) return invalid('Please wait before submitting again.');
    const f = await data(), kind = f.get('kind'), subject = kind==='self' ? me : Number(f.get('subject'));
    if (!['self','memory'].includes(kind) || (kind==='memory' && subject===me) ||
        !await one('SELECT id FROM roster WHERE id=?',subject)) return invalid('Choose a classmate.');
    const payload = kind==='self' ? Object.fromEntries(profileKeys.flatMap(key=>str(f,key)?[[key,str(f,key)]]:[])) :
      {story:str(f,'story'),credit:member.name};
    if (!Object.values(payload).some(Boolean) || (kind==='memory'&&!payload.story)) return invalid('Write an entry first.');
    const key = kind==='self'&&last ? last.id : id();
    const jobs = [sql(`INSERT INTO submissions(id,subject,contributor,kind,payload) VALUES(?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET payload=excluded.payload`,key,subject,me,kind,JSON.stringify(payload))];
    const saved = [];
    try {
      for (const slot of (kind==='self'?['then','now']:['memory'])) {
        const file = f.get(slot), hasFile = file instanceof File && file.size;
        if (!hasFile && !f.has('remove_'+slot)) continue;
        jobs.push(sql('DELETE FROM photos WHERE submission=? AND slot=?',key,slot));
        if (!hasFile) continue;
        const image = file.size<=15*1024*1024 && cleanPhoto(new Uint8Array(await file.arrayBuffer()));
        if (!image) return invalid('Use JPEG or PNG photos up to 15 MB.');
        const object = 'intake/'+id();
        await env.MEDIA.put(object,image.bytes,{httpMetadata:{contentType:image.type}});
        saved.push(object);
        jobs.push(sql('INSERT INTO photos VALUES(?,?,?,?)',key,object,slot,str(f,'caption_'+slot,240)));
      }
      await db.batch(jobs);
      saved.length=0;
      return kind==='self'?redirect('/yearbook'):show('Memory submitted','<p>Your memory was saved to the yearbook collection.</p>');
    } finally {
      await Promise.allSettled(saved.map(key=>env.MEDIA.delete(key)));
    }
  }
  if (path==='/yearbook') {
    const entries = await all("SELECT id,payload,created FROM submissions WHERE subject=? AND contributor=? AND kind='self' ORDER BY created DESC",me,me);
    const entry = entries[0];
    const photos = entry ? await all('SELECT object_key,slot,caption FROM photos WHERE submission=? ORDER BY slot,object_key',entry.id) : [];
    const payload = parse(entry?.payload);
    const selected = await one('SELECT fields,images FROM yearbook_public WHERE member=?',me);
    if (!post) return show('Your yearbook',page.yearbook(entry,payload,photos,selected,profileKeys));
    if (!entry) return invalid('No self-entry to publish.');
    const f = await data();
    const fields = Object.fromEntries(profileKeys.filter(k=>f.has(k)&&typeof payload[k]==='string').map(k=>[k,payload[k]]));
    const images = photos.filter((_,i)=>f.has('image_'+i)).map(p=>({submission:entry.id,key:p.object_key}));
    const announcement = 'yearbook-'+me;
    const publish = f.has('announce') && (Object.keys(fields).length || images.length);
    await db.batch([
      sql('INSERT OR REPLACE INTO yearbook_public VALUES(?,?,?)',me,JSON.stringify(fields),JSON.stringify(images)),
      publish ? sql(`INSERT INTO posts(id,author,body,created) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET hidden=0,created=excluded.created`,announcement,me,'I updated my yearbook profile.',now()) :
        sql('UPDATE posts SET hidden=1 WHERE id=?',announcement)
    ]);
    return redirect('/people/'+me);
  }
  if (path==='/gallery') {
    const personId = u.searchParams.has('person') ? Number(u.searchParams.get('person')) : null;
    return show('Gallery',page.images(await gallery(personId)));
  }
  if (path==='/topics') {
    const q = (u.searchParams.get('q')||'').slice(0,100);
    const rows = await all(`SELECT t.* FROM topics t WHERE t.hidden=0 AND t.redirect IS NULL AND instr(lower(t.title),lower(?))>0
      AND EXISTS(SELECT 1 FROM posts p WHERE p.topic=t.id AND p.hidden=0) ORDER BY t.title`,q);
    return show('Memory topics',page.topics(rows,q));
  }
  const topic = path.match(/^\/topics\/([\w-]+)$/);
  if (topic && !post) {
    const row = await one('SELECT * FROM topics WHERE id=?',topic[1]);
    if (row?.redirect) return redirect('/topics/'+row.redirect);
    if (!row || row.hidden) return missing();
    return show(row.title,page.topic(row,await posts('p.topic=?',[row.id])));
  }
  if (path==='/compose') {
    const subject = Number(u.searchParams.get('person')) || null;
    if (!post) return show('Share a memory',page.compose(
      await all('SELECT id,name FROM roster ORDER BY name'),
      await all('SELECT id,title FROM topics WHERE hidden=0 AND redirect IS NULL ORDER BY title'),
      subject,u.searchParams.get('topic')||'',id()));
    if (!await limit('post:'+me,10,20)) return invalid('Please wait before posting again.');
    if (Number(req.headers.get('Content-Length'))>96*1024*1024) return invalid('Photos are too large.');
    const f = await data(), key = str(f,'id',50), body = str(f,'body');
    if (!/^[a-f0-9-]{36}$/.test(key) || !body) return invalid('Write a memory first.');
    const original = await one('SELECT author FROM posts WHERE id=?',key);
    if (original) return original.author===me ? redirect('/posts/'+key) : missing();
    const subjectId = Number(f.get('subject')) || null;
    if (subjectId && !await one('SELECT id FROM roster WHERE id=?',subjectId)) return invalid('Choose an existing classmate.');
    let topicId = str(f,'topic',50) || null;
    const title = str(f,'title',100);
    if (title && topicId) return invalid('Choose an existing topic or enter a new one.');
    if (topicId && !await one('SELECT id FROM topics WHERE id=? AND hidden=0 AND redirect IS NULL',topicId)) return invalid('Topic unavailable.');
    const jobs = [];
    if (title) {
      const kind = str(f,'kind',12);
      if (!['Place','Item','Other'].includes(kind)) return invalid('Choose a topic type.');
      const existing = await one('SELECT id,hidden,redirect FROM topics WHERE title=? COLLATE NOCASE',title);
      if (existing?.hidden || existing?.redirect) return invalid('Choose a different topic title.');
      topicId = existing?.id || id();
      if (!existing) jobs.push(sql('INSERT INTO topics(id,title,kind) VALUES(?,?,?)',topicId,title,kind));
    }
    jobs.push(sql('INSERT INTO posts(id,author,subject,topic,body,created) VALUES(?,?,?,?,?,?)',key,me,subjectId,topicId,body,now()));
    const tag = Number(f.get('tag'));
    if (tag && tag!==me && await one('SELECT id FROM roster WHERE id=?',tag)) jobs.push(sql("INSERT INTO tags VALUES(?,?,'pending')",key,tag));
    const files = f.getAll('images').filter(image=>image instanceof File && image.size);
    if (files.length>6) return invalid('Choose up to six photos.');
    const uploaded = [];
    try {
      for (const [index,image] of files.entries()) {
        if (image.size>15*1024*1024) return invalid('Each photo must be 15 MB or smaller.');
        const bytes = new Uint8Array(await image.arrayBuffer());
        const clean = cleanPhoto(bytes);
        if (!clean) return invalid('Choose a JPEG or PNG photo. Re-export unsupported photos as JPEG.');
        const digest = await hash(clean.bytes);
        const imageId = id();
        const object = 'social/'+imageId;
        await env.MEDIA.put(object,clean.bytes,{httpMetadata:{contentType:clean.type}});
        uploaded.push(object);
        jobs.push(sql('INSERT INTO uploads VALUES(?,?,?,?,?,?,?,?)',imageId,me,object,clean.type,digest,str(f,'caption_'+index,240),key,now()));
      }
      await db.batch(jobs);
      uploaded.length=0;
      return redirect('/posts/'+key);
    } finally {
      await Promise.allSettled(uploaded.map(key=>env.MEDIA.delete(key)));
    }
  }
  const postMatch = path.match(/^\/posts\/([\w-]+)$/);
  if (postMatch) {
    const key = postMatch[1];
    const item = (await posts('p.id=?',[key],1))[0];
    if (!item) return missing();
    if (!post) {
      const comments = await all('SELECT c.*,r.name FROM comments c JOIN roster r ON r.id=c.author WHERE c.post=? AND c.hidden=0 ORDER BY c.created,c.id',key);
      const tags = await all("SELECT t.*,r.name FROM tags t JOIN roster r ON r.id=t.member WHERE t.post=? AND (t.status='accepted' OR t.member=? OR ?=?)",key,me,me,item.author);
      const images = await all("SELECT 'post/'||id AS media,caption,'/posts/'||post AS source FROM uploads WHERE post=? UNION ALL SELECT 'legacy/'||?||'/'||ROW_NUMBER() OVER(ORDER BY object_key),caption,'/posts/'||? FROM photos WHERE submission=?",key,key,key,item.origin);
      return show('A batch memory',page.post(item,comments,tags,images,me));
    }
    const f = await data(), action = f.get('action');
    if (action==='like') {
      if (f.get('liked')==='1') await run('INSERT OR IGNORE INTO likes VALUES(?,?)',key,me);
      else await run('DELETE FROM likes WHERE post=? AND member=?',key,me);
    } else if (action==='comment') {
      const body = str(f,'body',1200);
      if (body && await limit('comment:'+me,10,30)) await run('INSERT INTO comments(id,post,author,body,created) VALUES(?,?,?,?,?)',id(),key,me,body,now());
    } else if (action==='edit-comment' || action==='delete-comment') {
      const comment = str(f,'comment',50), body = str(f,'body',1200);
      if (action==='edit-comment' && body) await run('UPDATE comments SET body=? WHERE id=? AND post=? AND author=?',body,comment,key,me);
      else if (action==='delete-comment') await run('UPDATE comments SET hidden=1 WHERE id=? AND post=? AND author=?',comment,key,me);
    } else if (action==='tag-accept' || action==='tag-remove') {
      await run('UPDATE tags SET status=? WHERE post=? AND member=?',action==='tag-accept'?'accepted':'declined',key,me);
    } else if (action==='unassociate' && item.subject===me) {
      await run('INSERT OR IGNORE INTO muted_subjects VALUES(?)',key);
    } else if (action==='delete' && item.author===me) {
      await run('UPDATE posts SET hidden=1 WHERE id=?',key);
      return redirect('/');
    } else if (action==='edit' && item.author===me) {
      const body = str(f,'body');
      if (body) await run('UPDATE posts SET body=? WHERE id=?',body,key);
    } else return invalid('Action unavailable.');
    return redirect(path);
  }
  if (path==='/report' && post) {
    const f = await data(), target = str(f,'target',100), type = str(f,'type',20), reason = str(f,'reason',1000);
    if (!['profile','post','comment','photo','tag','topic'].includes(type)||!target||!reason) return invalid('Add a reason.');
    if (await limit('report:'+me,30,12)) await run('INSERT INTO reports(id,reporter,target_type,target,reason,created) VALUES(?,?,?,?,?,?)',id(),me,type,target,reason,now());
    return show('Report received','<p>The batch admins can review it.</p>');
  }
  if (path==='/notifications') {
    if (post) {
      await run('INSERT OR REPLACE INTO notification_reads VALUES(?,?)',me,now());
      return redirect(path);
    }
    const rows = await all(`SELECT p.id,r.name||' commented on your memory' AS label,c.created
      FROM comments c JOIN posts p ON p.id=c.post JOIN roster r ON r.id=c.author
      WHERE p.author=? AND c.author<>? AND c.hidden=0 AND ${postVisible}
      UNION ALL SELECT p.id,r.name||' tagged you',p.created FROM tags g JOIN posts p ON p.id=g.post
      JOIN roster r ON r.id=p.author WHERE g.member=? AND g.status='pending' AND ${postVisible} ORDER BY created DESC LIMIT 100`,me,me,me);
    const seen = await one('SELECT seen FROM notification_reads WHERE member=?',me);
    return show('Notifications',page.notifications(rows,seen?.seen||0));
  }
  if (path==='/admin/export' && admin && !post) {
    if (u.searchParams.get('kind')==='pending') return json(await all(`SELECT r.id,r.name,c.email,m.mobile FROM roster r
      LEFT JOIN reminder_contacts c ON c.batchmate_id=r.id LEFT JOIN reminder_mobiles m ON m.batchmate_id=r.id
      WHERE NOT EXISTS(SELECT 1 FROM submissions s WHERE s.subject=r.id AND s.kind='self') ORDER BY r.name`));
    return json({submissions:await all('SELECT * FROM submissions ORDER BY created'),photos:await all('SELECT * FROM photos ORDER BY submission,slot')});
  }
  if (path==='/admin' && admin) {
    if (!post) return show('Batch admin',page.admin(
      await all('SELECT * FROM reports WHERE resolved=0 ORDER BY created DESC LIMIT 100'),
      await all("SELECT s.roster_id,r.name,s.review_status FROM profile_seeds s JOIN roster r ON r.id=s.roster_id ORDER BY r.name"),
      await all('SELECT id,title FROM topics WHERE hidden=0 ORDER BY title'),
      await all("SELECT s.id,r.name FROM submissions s JOIN roster r ON r.id=s.subject WHERE s.kind='memory' AND NOT EXISTS(SELECT 1 FROM posts p WHERE p.origin=s.id) ORDER BY s.created DESC")));
    const f = await data(), action = str(f,'action',40), target = str(f,'target',100), reason = str(f,'reason',1000);
    if (action==='attendance-preview' || action==='attendance-apply') {
      const lines = str(f,'rsvp',40000).split(/\r?\n/).filter(Boolean);
      const roster = new Set((await all('SELECT id FROM roster')).map(r=>r.id));
      const detected = new Set(), changes = [], errors = [];
      for (const [i,line] of lines.entries()) {
        const [raw,status,...extra] = line.split(',').map(v=>v.trim());
        if (i===0 && raw==='roster_id' && status==='status') continue;
        const key = Number(raw);
        if (extra.length || !roster.has(key) || !Object.hasOwn(attendanceNames,status) || detected.has(key)) errors.push(i+1);
        else {detected.add(key); changes.push([key,status]);}
      }
      if (!changes.length || errors.length) return invalid('No valid import. Check unknown or duplicate IDs and statuses on lines '+errors.join(', '));
      if (action==='attendance-preview') return show('Review attendance import',page.attendancePreview(changes,str(f,'rsvp',40000)));
      await db.batch([...changes.map(r=>sql('INSERT OR REPLACE INTO attendance VALUES(?,?)',...r)),
        sql('INSERT INTO audit VALUES(?,?,?,?,?,?)',id(),me,action,String(changes.length),'Tracker import',now())]);
      return redirect(path);
    }
    let update;
    if (action==='hide-post'||action==='restore-post') update=sql('UPDATE posts SET hidden=? WHERE id=?',+(action==='hide-post'),target);
    if (action==='hide-comment'||action==='restore-comment') update=sql('UPDATE comments SET hidden=? WHERE id=?',+(action==='hide-comment'),target);
    if (action==='hide-topic') update=sql('UPDATE topics SET hidden=1 WHERE id=?',target);
    if (action==='rename-topic') update=sql('UPDATE topics SET title=? WHERE id=?',str(f,'title',100),target);
    if (action==='approve-seed'||action==='hold-seed') update=sql('UPDATE profile_seeds SET review_status=? WHERE roster_id=?',action==='approve-seed'?'approved':'identity_review',Number(target));
    if (action==='resolve-report') update=sql('UPDATE reports SET resolved=1 WHERE id=?',target);
    if (action==='invite') update=sql('INSERT INTO members(id,invited) VALUES(?,1) ON CONFLICT(id) DO UPDATE SET invited=1',Number(target));
    if (action==='revoke') update=sql('DELETE FROM sessions WHERE member=?',Number(target));
    if (action==='publish-memory') {
      const legacy = await one("SELECT * FROM submissions WHERE id=? AND kind='memory'",target);
      const body = parse(legacy?.payload).story;
      if (typeof body==='string' && body.trim()) update=sql('INSERT OR IGNORE INTO posts(id,author,subject,body,created,origin) VALUES(?,?,?,?,?,?)',
        id(),legacy.contributor,legacy.subject,body,Date.parse(legacy.created)||now(),legacy.id);
    }
    if (action==='merge-topic') {
      const to = str(f,'into',80);
      if (to===target || !await one('SELECT id FROM topics WHERE id=? AND hidden=0 AND redirect IS NULL',to)) return invalid('Choose an active destination topic.');
      await db.batch([sql('UPDATE posts SET topic=? WHERE topic=?',to,target),sql('UPDATE topics SET redirect=? WHERE id=?',to,target),
        sql('UPDATE topics SET redirect=? WHERE redirect=?',to,target),sql('INSERT INTO audit VALUES(?,?,?,?,?,?)',id(),me,action,target,reason,now())]);
      return redirect(path);
    }
    if (!update || !reason) return invalid('Choose an action and provide a reason.');
    await db.batch([update,sql('INSERT INTO audit VALUES(?,?,?,?,?,?)',id(),me,action,target,reason,now())]);
    return redirect(path);
  }
  return missing();
}

function cleanPhoto(bytes) {
  if (bytes[0]===255 && bytes[1]===216) {
    const parts=[bytes.subarray(0,2)];
    let offset=2;
    while (offset+4<=bytes.length && bytes[offset]===255) {
      const marker=bytes[offset+1];
      if (marker===218 && bytes.at(-2)===255 && bytes.at(-1)===217) {
        parts.push(bytes.subarray(offset));
        return {bytes:joinBytes(parts),type:'image/jpeg'};
      }
      const length=bytes[offset+2]*256+bytes[offset+3];
      if (length<2||offset+2+length>bytes.length) return null;
      if (!(marker>=225&&marker<=239)&&marker!==254) parts.push(bytes.subarray(offset,offset+2+length));
      offset+=2+length;
    }
  }
  if ([137,80,78,71,13,10,26,10].every((byte,index)=>bytes[index]===byte)) {
    const parts=[bytes.subarray(0,8)], view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    for (let offset=8;offset+12<=bytes.length;) {
      const size=view.getUint32(offset), end=offset+size+12;
      if (end>bytes.length) return null;
      const type=String.fromCharCode(...bytes.subarray(offset+4,offset+8));
      if (['IHDR','PLTE','IDAT','IEND','tRNS'].includes(type)) parts.push(bytes.subarray(offset,end));
      if (type==='IEND') return {bytes:joinBytes(parts),type:'image/png'};
      offset=end;
    }
  }
  return null;
}
function joinBytes(parts) {
  const joined = new Uint8Array(parts.reduce((size,part)=>size+part.length,0));
  let offset=0;
  for (const part of parts) {joined.set(part,offset);offset+=part.length;}
  return joined;
}

async function servePhoto(env,row) {
  if (!row?.object_key) return missing();
  const object = await env.MEDIA.get(row.object_key);
  if (!object) return missing();
  const type = row.type || object.httpMetadata?.contentType || ({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif'})[row.object_key.split('.').pop().toLowerCase()];
  if (!['image/jpeg','image/png','image/webp','image/gif','image/avif'].includes(type)) return missing();
  return new Response(object.body,{headers:{'Content-Type':type}});
}
