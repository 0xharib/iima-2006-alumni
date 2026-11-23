import { theme } from './theme.mjs';
export const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const e=escape;
const link=(href,label)=>`<a href="${e(href)}">${e(label)}</a>`;
const badge=text=>text?`<small>${e(text)}</small>`:'';
const checkbox=(name,label,checked=false)=>`<label class="check"><input type="checkbox" name="${e(name)}"${checked?' checked':''}> ${e(label)}</label>`;
const select=(name,label,options,selected='')=>`<label>${e(label)}<select name="${name}">${options.map(([value,text])=>`<option value="${e(value)}"${String(value)===String(selected)?' selected':''}>${e(text)}</option>`).join('')}</select></label>`;
const input=(name,label,value='',extra='')=>`<label>${e(label)}<input name="${e(name)}" value="${e(value)}" ${extra}></label>`;
const area=(name,label,value='',extra='')=>`<label>${e(label)}<textarea name="${e(name)}" ${extra}>${e(value)}</textarea></label>`;
export const field=(name,value)=>`<input type="hidden" name="${e(name)}" value="${e(value)}">`;
export const form=(action,body,label,extra='')=>`<form method="post" action="${e(action)}" ${extra}>${body}<button type="submit">${e(label)}</button></form>`;
const action=(url,name,label,values={})=>form(url,field('action',name)+Object.entries(values).map(([key,val])=>field(key,val)).join(''),label,'class="inline"');
const report=(type,target)=>`<details><summary>Report ${e(type)}</summary>${form('/report',field('type',type)+field('target',target)+area('reason','What needs checking?','','required maxlength="1000"'),'Send report')}</details>`;
const list=(items,empty)=>items.length?`<ul class="plain">${items.map(item=>`<li>${item}</li>`).join('')}</ul>`:`<p>${e(empty)}</p>`;
const labelFor=key=>({life:'Life, lately',firstDayAdvice:'Advice to my first-day self',outsideWork:'Outside work',reunionStory:'Reunion story',anythingElse:'Anything else',printName:'Yearbook name',moment:'A memorable moment'}[key]||key[0].toUpperCase()+key.slice(1));
const images=items=>items.length?`<div class="photos">${items.map(row=>`<figure><a href="/media/${e(row.media)}"><img src="/media/${e(row.media)}" loading="lazy" alt="${e(row.caption||'Batch photo')}"></a><figcaption>${e(row.caption)} ${link(row.source,'Context')}</figcaption></figure>`).join('')}</div>`:'<p>No published photos yet.</p>';
const portrait=(person,lazy=true)=>person.portrait
  ? `<img src="/media/${e(person.portrait)}" alt="" ${lazy?'loading="lazy"':''}>`
  : `<span class="initials" aria-hidden="true">${e(person.name.trim().split(/\s+/).slice(0,2).map(word=>word[0]).join(''))}</span>`;
const card=(p,back)=>`<article><header>${link('/people/'+p.author,p.author_name)} <time datetime="${new Date(p.created).toISOString()}">${e(new Date(p.created).toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata'}))}</time></header>
  ${p.topic?link('/topics/'+p.topic,p.topic_title):''}${p.subject_name?`<small>About ${link('/people/'+p.subject,p.subject_name)}</small>`:''}
  ${p.feed_photo||p.has_legacy_photo?`<a class="feed-photos" href="/posts/${e(p.id)}"><img src="/media/${p.feed_photo?'post/'+e(p.feed_photo):'legacy/'+e(p.id)+'/1'}" alt="Yearbook memory photo" loading="lazy"></a>`:''}<p class="story">${e(p.body)}</p>${link('/posts/'+p.id,'Open memory')} ${action('/posts/'+p.id,'like',p.liked?'Unlike':'Like',{liked:p.liked?0:1,...(back?{return:back}:{})})} ${badge(p.likes+' likes')}</article>`;
const cards=(rows,back)=>rows.map(row=>card(row,back)).join('')||'<p>No memories here yet.</p>';

export function render(title,body,member,{home=false}={}) {
  const nav=member?`<nav aria-label="Main navigation">${link('/','Home')}${link('/memories','Memories')}${link('/reunion','Reunion')}
    <details class="account"><summary aria-label="My profile menu">${portrait(member,false)}</summary>
      <div class="account-menu">${link('/people/'+member.id,'View profile')}${link('/notifications','Notifications')}
      ${member.role==='admin'?link('/admin','Admin'):''}${form('/logout','','Log out')}</div></details></nav>`:'';
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)} · IIMA ’06</title><style>
  :root{color-scheme:light;--ink:#251a16;--muted:#654138;--paper:#fbf3e7;--tile:#fffaf3;--brick:#883b2e;--line:#dfcabc}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:1rem/1.5 system-ui,sans-serif}a{color:#74291d;text-underline-offset:.18em}button,input,textarea,select{font:inherit}button{cursor:pointer;border:0;border-radius:2rem;background:var(--brick);color:white;padding:.55rem 1rem;margin-block:.4rem}input:not([type=checkbox]),textarea,select{display:block;width:100%;padding:.5rem;border:1px solid #ac8b7b;border-radius:.5rem;background:#fff;color:var(--ink)}textarea{min-height:6rem}input[type=checkbox]{margin-right:.35rem}label{display:block;margin:.6rem 0}.check{display:flex;align-items:center}.bar{background:#f1e0cf;border-bottom:1px solid var(--line)}.bar div,main,footer{max-width:960px;margin:auto;padding:1rem clamp(1rem,4vw,2.3rem)}.wordmark{font:700 1.25rem Georgia,serif;text-decoration:none}nav{display:flex;flex-wrap:wrap;gap:.35rem 1rem;margin-top:.65rem}nav a{font-weight:600}h1,h2,h3{line-height:1.14;font-family:Georgia,serif}h1{font-size:clamp(2.3rem,7vw,4.5rem);margin:.65em 0 .3em}h2{font-size:1.65rem}article,fieldset,.panel{background:var(--tile);border:1px solid var(--line);border-radius:.9rem;padding:1rem;margin:1rem 0;min-width:0}article header{display:flex;gap:.5rem 1rem;justify-content:space-between;flex-wrap:wrap}time,small{color:var(--muted)}.plain{list-style:none;padding:0}.plain li{padding:.45rem 0;border-bottom:1px solid var(--line)}.photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(145px,100%),1fr));gap:1rem}figure{margin:0}img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:.6rem;display:block;background:#ead7c5}figcaption{font-size:.9rem}.inline{display:inline-block;margin-right:.4rem}.story{white-space:pre-wrap;overflow-wrap:anywhere}.new{font-weight:700}:focus-visible{outline:3px solid #296769;outline-offset:3px}summary{cursor:pointer;margin:.5rem 0}dd{margin:0 0 .8rem;white-space:pre-wrap;overflow-wrap:anywhere}dt{font-weight:650}
  ${theme}
  .bar .account-menu{position:absolute;right:0;top:100%;z-index:5;min-width:10rem;padding:.8rem;background:var(--tile);border:1px solid var(--line);border-radius:.8rem;box-shadow:0 12px 28px #24161030}
  .account{position:relative;margin-left:auto}.account summary{list-style:none;margin:0}.account summary::-webkit-details-marker{display:none}.account summary img,.account summary .initials{width:2.4rem;height:2.4rem;border-radius:50%;aspect-ratio:1;display:grid;place-items:center;background:#ead7c5}
  .account-menu a{display:block;margin-bottom:.4rem}.directory-controls{display:grid;grid-template-columns:2fr 1fr auto;align-items:end;gap:.75rem;margin-bottom:1.25rem}
  .directory-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(10rem,100%),1fr));gap:1rem}.directory-card{display:block;overflow:hidden;background:var(--tile);border:1px solid var(--line);border-radius:1rem;text-decoration:none}.directory-card img,.directory-card .initials{width:100%;aspect-ratio:1;display:grid;place-items:center;background:#ead7c5;border-radius:0;font-size:2rem}.directory-card div{padding:.75rem}.directory-card small{display:block}
  .profile-hero{display:grid;grid-template-columns:minmax(0,16rem) minmax(0,1fr);gap:clamp(1rem,5vw,3rem);align-items:center;background:var(--tile);border:1px solid var(--line);padding:clamp(1rem,4vw,2.5rem);margin:1.25rem 0;border-radius:1.5rem}
  .profile-hero h1{margin:.2em 0;font-size:clamp(2rem,6vw,4rem)}.profile-hero img,.profile-hero .initials{width:100%;aspect-ratio:1;display:grid;place-items:center;background:#ead7c5;border-radius:1rem;font-size:4rem}.profile-content{max-width:46rem;margin:auto}
  .memory-nav{display:flex;flex-wrap:wrap;gap:.6rem 1.3rem;align-items:center;margin-bottom:1rem}.memory-feed{max-width:44rem}
  @media(max-width:600px){.profile-hero{grid-template-columns:1fr}.profile-hero img,.profile-hero .initials{max-width:18rem}.directory-controls{grid-template-columns:1fr 1fr}.directory-controls label:first-child{grid-column:1/-1}}
  </style><body${home?' class="home"':''}><header class="bar"><div class="mast"><a class="wordmark" href="/"><img src="/campus/logo.png" alt="">IIMA Class of ’06</a>${nav}</div></header><main>${home?'':'<h1>'+e(title)+'</h1>'}${body}</main></html>`,{headers:{'Content-Type':'text/html; charset=utf-8'}});
}
export const page={
  pickerScript:`const box=document.querySelector('#name-search'); const results=document.querySelector('#name-results'); let revision=0;
    box.addEventListener('input',async()=>{const request=++revision; const q=box.value.trim(); results.replaceChildren(); if(q.length<2)return;
    try { const response=await fetch('/names?q='+encodeURIComponent(q)); const names=await response.json(); if(request!==revision)return;
    for(const item of names){ const li=document.createElement('li'), a=document.createElement('a'); a.textContent=item.name; a.href='/signin?id='+item.id+'&next='+encodeURIComponent(box.dataset.next); li.append(a); results.append(li); }
    if(!names.length) results.textContent='No matching names.'; } catch { if(request===revision)results.textContent='Search unavailable. Try again.'; }});
    document.addEventListener('submit',async event=>{
      const form=event.target;
      if (form.getAttribute('action')!=='/request-link') return;
      event.preventDefault();
      const button=form.querySelector('button'), feedback=form.previousElementSibling;
      button.disabled=true;
      try {
        const response=await fetch(form.action,{method:'POST',body:new FormData(form)});
        if (!response.ok) throw new Error('Request failed');
        const result=new DOMParser().parseFromString(await response.text(),'text/html').querySelector('.selection');
        if (!result) throw new Error('Missing result');
        form.closest('.selection').replaceWith(result);
      } catch {
        feedback.textContent='Could not request a link. Please try again.';
        button.disabled=false;
      }
    });`,
  home(rows,next,people,member,back){
    return `<section class="campus-hero"><div><p class="class-label">IIM Ahmedabad · Class of 2006</p>
      <h1>Twenty years on.</h1><p>Welcome back, ${e(member.name.trim().split(/\s+/)[0])}.</p>
      <div class="hero-actions"><a class="cta" href="/people">Find classmates</a><a class="cta secondary" href="/compose">Share a memory</a></div>
      </div></section>
      <div class="home-links">
        <a class="shortcut image steps" href="/reunion"><strong>December reunion</strong><small>See who’s coming</small></a>
        <a class="shortcut image light" href="/memories"><strong>Memories</strong><small>Read stories and browse photos</small></a>
        <a class="shortcut" href="/people/${member.id}"><strong>My profile</strong><small>View your yearbook and profile</small></a>
      </div>
      <div class="home-columns">
        <section><div class="section-head"><h2>Batch memories</h2>${link('/memories','See all memories →')}</div>
          ${cards(rows,back)}${next?'<a class="soft-link" href="'+e(next)+'">Older memories</a>':''}</section>
        <section><div class="section-head"><h2>Classmates</h2>${link('/people','See directory →')}</div>
          <div class="people-grid">${people.map(person=>`<a class="person-tile" href="/people/${person.id}">${person.portrait_key?`<img src="/media/seed/${person.id}" alt="" loading="lazy">`:`<span class="initials" aria-hidden="true">${e(person.name.trim().split(/\s+/).slice(0,2).map(word=>word[0]).join(''))}</span>`}<strong>${e(person.name)}</strong></a>`).join('')}</div></section>
      </div>`;
  },
  memories(rows,next,back){return `<div class="memory-nav">${link('/gallery','Browse gallery')}${link('/topics','Browse topics')}${link('/compose','Share a memory')}</div>
    <div class="memory-feed">${cards(rows,back)}${next?link(next,'Older memories'):''}</div>`;},
  gallery(photos){return `<div class="memory-nav">${link('/memories','Back to memories')}</div>${images(photos)}`;},
  directory(rows,statuses,q,status){return `<form class="directory-controls" method="get">${input('q','Name, nickname or dorm',q)}${select('status','Attendance',[['','All classmates'],...Object.entries(statuses)],status)}<button>Search</button></form>
    ${rows.length?`<div class="directory-grid">${rows.map(row=>`<a class="directory-card" href="/people/${row.id}">${portrait(row)}<div><strong>${e(row.name)}</strong>${badge(row.dorm)}${badge(statuses[row.status])}</div></a>`).join('')}</div>`:'<p>No classmates match.</p>'}`;},
  person(row,status,details,photos,stories,me,pilot){return `<section class="profile-hero">${portrait(row,false)}<div><h1>${e(row.name)}</h1>
    <p>${e([details.dorm,details.city,details.company].filter(Boolean).join(' · '))}</p>${badge(status)}
    <div class="memory-nav">${me===row.id?link('/profile','Edit profile')+link('/yearbook','Review yearbook'):link('/compose?person='+row.id,'Add a memory')}</div></div></section>
    <div class="profile-content">${pilot?'<p>Profiles are being checked during the pilot.</p>':''}${/^https:\/\/(?:www\.)?linkedin\.com\/in\//i.test(row.linkedin||'')?`<p><a class="soft-link" href="${e(row.linkedin)}" rel="noreferrer">LinkedIn profile ↗</a></p>`:''}
    <dl>${Object.entries(details).filter(([,value])=>value).map(([key,value])=>`<dt>${e(labelFor(key))}</dt><dd>${e(value)}</dd>`).join('')}</dl>
    <h2>Photos</h2>${images(photos)}<h2>Memories from classmates</h2>${cards(stories.filter(p=>p.author!==row.id),'/people/'+row.id)}
    <h2>Memories shared</h2>${cards(stories.filter(p=>p.author===row.id),'/people/'+row.id)}${report('profile',row.id)}</div>`;},
  editProfile(fields,member){const keys=['life','city','company','education','dorm','family','nickname'];
    return form('/profile',keys.map(k=>area(k,labelFor(k),fields[k])+checkbox('hide_'+k,'Hide '+labelFor(k),fields[k]==='')).join('')+checkbox('attendance_private','Hide my attendance status',!!member.attendance_private),'Save profile');},
  intake(roster,me,payload,keys) {
    const photos = slot => '<fieldset><legend>'+e(labelFor(slot))+' photo</legend><label>JPEG or PNG<input name="'+slot+'" type="file" accept="image/jpeg,image/png"></label>'+
      input('caption_'+slot,'Photo caption')+checkbox('remove_'+slot,'Remove saved photo')+'</fieldset>';
    return '<h2>My entry</h2>'+form('/submit',field('kind','self')+keys.map(k=>area(k,labelFor(k),payload[k])).join('')+
      photos('then')+photos('now'),'Save my entry','enctype="multipart/form-data"')+
      '<h2>Contribute to a classmate’s entry</h2>'+form('/submit',field('kind','memory')+
      select('subject','Classmate',roster.filter(row=>row.id!==me).map(row=>[row.id,row.name]))+
      area('story','Your memory','','required maxlength="4000"')+photos('memory'),'Save contribution','enctype="multipart/form-data"');
  },
  yearbook(entry,payload,photos,selected,keys){
    if(!entry)return '<p>We have no self-entry on file for you.</p><p>'+link('/submit','Submit your entry')+'</p>';
    const values=JSON.parse(selected?.fields||'{}'), publicPhotos=JSON.parse(selected?.images||'[]');
    return `<p>Choose which parts classmates can see.</p>`+form('/yearbook',keys.filter(k=>typeof payload[k]==='string'&&payload[k]).map(k=>`<fieldset><legend>${e(labelFor(k))}</legend><p class="story">${e(payload[k])}</p>${checkbox(k,'Publish this answer',Object.hasOwn(values,k))}</fieldset>`).join('')+
      photos.map((p,i)=>`<fieldset><legend>${e(p.slot)}</legend><img src="/yearbook-preview/${i}" alt="${e(p.caption||p.slot)}">${checkbox('image_'+i,'Publish this photo',publicPhotos.some(x=>x.submission===entry.id&&x.key===p.object_key))}</fieldset>`).join('')+checkbox('announce','Announce in the feed'),'Save published selection');},
  images,
  topics(rows,q){return `<form method="get">${input('q','Find a memory topic',q)}<button>Search</button></form><p>${link('/compose','Create a topic and add a memory')}</p>`+list(rows.map(r=>link('/topics/'+r.id,r.title)+' '+badge(r.kind)),'No topics yet.');},
  topic(row,rows){return `${badge(row.kind)}<p>${link('/compose?topic='+row.id,'Add your memory')}</p>${cards(rows)}${report('topic',row.id)}`;},
  compose(roster,topics,person,topic,key){
    const names=[['','Choose a classmate'],...roster.map(r=>[r.id,r.name])];
    return form('/compose',field('id',key)+area('body','Your memory','','required maxlength="4000"')+
      select('subject','Memory about a classmate',names,person)+select('tag','Tag a classmate',names)+
      select('topic','Existing memory topic',[['','Choose a topic'],...topics.map(t=>[t.id,t.title])],topic)+
      `<fieldset><legend>Or create a new topic</legend>${input('title','Topic name','','maxlength="100"')}${select('kind','Topic type',[['Other','Other'],['Place','Place'],['Item','Item']])}</fieldset>
      <fieldset><legend>Photos</legend><label>Choose up to six JPEG or PNG images<input type="file" name="images" accept="image/jpeg,image/png" multiple></label>
      <details><summary>Add captions</summary>${Array.from({length:6},(_,i)=>input('caption_'+i,'Caption for photo '+(i+1),'','maxlength="240"')).join('')}</details></fieldset>`,'Publish memory','enctype="multipart/form-data"');},
  post(item,comments,tags,photos,me){
    const url='/posts/'+item.id;
    return card(item)+images(photos)+
      (item.author===me?`<details><summary>Edit memory</summary>${form(url,field('action','edit')+area('body','Memory',item.body,'required'),'Save')}</details>${action(url,'delete','Delete memory')}`:'')+
      (item.subject===me?action(url,'unassociate','Remove from my profile'):'')+report('post',item.id)+
      (tags.length?'<h2>Tags</h2>'+list(tags.map(t=>link('/people/'+t.member,t.name)+' '+badge(t.status)+
       (t.member===me?(t.status==='pending'?action(url,'tag-accept','Accept tag'):'')+action(url,'tag-remove','Remove tag'):'')),''):'')+
      '<h2>Comments</h2>'+list(comments.map(c=>`${link('/people/'+c.author,c.name)}<p class="story">${e(c.body)}</p>${c.author===me?
      `<details><summary>Edit comment</summary>${form(url,field('action','edit-comment')+field('comment',c.id)+input('body','Comment',c.body,'required'),'Save')}</details>${action(url,'delete-comment','Delete comment',{comment:c.id})}`:''}${report('comment',c.id)}`),'No comments yet.')+
      form(url,field('action','comment')+area('body','Add a comment','','required maxlength="1200"'),'Post comment');
  },
  notifications(rows,seen){return list(rows.map(n=>`<span class="${n.created>seen?'new':''}">${link('/posts/'+n.id,n.label)}</span>`),'No notifications yet.')+form('/notifications','','Mark all read');},
  admin(reports,seeds,topics,memories){const actions=['invite','revoke','approve-seed','hold-seed','resolve-report','hide-post','restore-post','hide-comment','restore-comment','rename-topic','hide-topic','merge-topic','publish-memory'];
    return `<h2>Reports</h2>${list(reports.map(r=>`<strong>${e(r.target_type)} ${e(r.target)}</strong><br>${e(r.reason)}<br>Report ID ${e(r.id)}`),'No open reports.')}
      <h2>Take action</h2>${form('/admin',select('action','Action',actions.map(a=>[a,a.replaceAll('-',' ')]))+input('target','Target ID','','required')+
      input('reason','Reason','','required')+input('into','Merge destination topic ID')+input('title','New topic title'),'Apply action')}
      <h2>Reunion tracker</h2>${form('/admin',field('action','attendance-preview')+area('rsvp','CSV with roster_id,status (attending, declined, unknown)','','required'),'Preview import')}
      <p>${link('/admin/export','Submission data')} · ${link('/admin/export?kind=pending','Pending contact data')}</p>
      <details><summary>Yearbook memories awaiting publication</summary>${list(memories.map(m=>e(m.name)+' · '+e(m.id)),'No pending memories.')}</details>
      <details><summary>Profile seeds</summary>${list(seeds.map(s=>`${link('/people/'+s.roster_id,s.name)} · ${e(s.roster_id)} · ${e(s.review_status)}`),'No seeds.')}</details>
      <details><summary>Topic IDs</summary>${list(topics.map(t=>link('/topics/'+t.id,t.title)+' · '+e(t.id)),'No topics.')}</details>`;
  },
  attendancePreview(rows,csv){return `<p>${rows.length} RSVP updates.</p>${list(rows.map(r=>e(r.join(' · '))),'')}${form('/admin',field('action','attendance-apply')+field('rsvp',csv),'Apply import')}`;}
};

export function signIn({ selected, maskedEmail, next, mailHelp, yearbookUrl, feedback }) {
  const photoUrl = 'https://archives.iima.ac.in/public/convocation/groupphoto/2006.jpg';
  const selection = selected ? `
    <div class="selection">
      <strong>${e(selected.name)}</strong>
      <p>${e(maskedEmail || 'No usable email on file')}</p>
      <div class="request-feedback" role="status">${e(feedback)}</div>
      ${maskedEmail && !feedback.startsWith('Check your inbox') ? form('/request-link',field('id',selected.id)+field('next',next),'Email me a sign-in link') : ''}
      <p class="help">Need to edit this email or email unavailable? Email <a href="${e(mailHelp)}">Tahseen and Arun</a>.</p>
    </div>` : '';
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign in · IIMA Class of 2006</title>
  <style>
    :root { color-scheme:light; --paper:#f6f4ef; --ink:#242721; --muted:#555a50; --accent:#873d31; --line:#dedbd3; font:16px/1.5 system-ui,sans-serif }
    * { box-sizing:border-box }
    body { margin:0; background:var(--paper); color:var(--ink) }
    a { color:var(--accent); text-decoration:none }
    a:hover { text-decoration:underline }
    :focus-visible { outline:3px solid #975044; outline-offset:4px }
    .shell { max-width:1240px; margin:auto; padding:0 clamp(16px,5vw,64px) 48px }
    .masthead { min-height:74px; display:flex; align-items:center; justify-content:space-between; gap:16px; border-bottom:1px solid var(--line) }
    .brand { display:flex; align-items:center; gap:10px; color:var(--ink); font-size:.94rem; font-weight:750; text-decoration:none }
    .mark { display:grid; place-items:center; width:35px; height:35px; background:white; border-radius:50%; padding:2px; object-fit:contain }
    .yearbook { font-size:.87rem; font-weight:650 }
    .intro { margin:22px 0; min-height:clamp(185px,32vw,370px); display:flex; align-items:end; border-radius:22px; padding:clamp(22px,5vw,58px); color:#fffaf0; background:linear-gradient(90deg,#160d0cda,#190e0c28),#251a16 url('/campus/arches.webp') center 49% / cover }
    h1,h2 { margin:0; line-height:1.08 }
    h1 { font:500 clamp(2.9rem,8vw,6.4rem)/.97 Georgia,serif; letter-spacing:-.072em }
    .layout { display:grid; grid-template-columns:minmax(0,1.65fr) minmax(300px,1fr); align-items:start; gap:clamp(18px,3vw,36px) }
    figure { margin:0; min-width:0 }
    figure img { display:block; width:100%; height:auto; border-radius:17px; background:#e7e1d6 }
    figcaption { margin:10px 2px 0; font-size:.8rem; color:var(--muted) }
    .card { background:#fff; border:1px solid var(--line); border-radius:17px; padding:clamp(18px,3vw,32px); box-shadow:0 12px 32px #3024190a }
    h2 { font-size:clamp(1.55rem,3vw,2rem); letter-spacing:-.045em }
    p { margin:.65rem 0 }
    .instructions,.help,.selection p { color:var(--muted); font-size:.92rem }
    label { display:block; margin-top:20px; font-weight:650; font-size:.84rem }
    .search { display:flex; align-items:center; gap:10px; border:1px solid #a9ada0; background:#fafaf8; border-radius:10px; padding:0 12px; margin-top:7px }
    .search svg { flex:0 0 18px; color:var(--muted) }
    .search:focus-within { outline:2px solid var(--accent); outline-offset:2px }
    input { width:100%; min-width:0; outline:none; border:0; background:transparent; padding:12px 0; color:var(--ink); font:inherit }
    input:focus-visible { outline:none }
    ul { list-style:none; margin:6px 0 0; padding:0; font-size:.92rem }
    ul:empty { display:none }
    li a { display:block; padding:7px 9px; border-radius:7px }
    li a:hover { background:#f4eee9 }
    .selection { margin-top:16px; border-top:1px solid var(--line); padding-top:16px; overflow-wrap:anywhere }
    .selection p { margin:.15rem 0 .7rem }
    button { padding:10px 15px; border:0; border-radius:9px; background:var(--accent); color:white; font:650 .9rem/1.4 system-ui,sans-serif; cursor:pointer }
    button:hover { background:#703126 }
    .help { margin:20px 0 0 }
    @media(max-width:750px) {
      .masthead { min-height:60px }
      .layout { grid-template-columns:1fr }
      figure img { max-height:32vh; object-fit:contain; background:#e9e4d9 }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header class="masthead">
      <a href="/" class="brand"><img class="mark" src="/campus/logo.png" alt="">IIMA Class of 2006</a>
      ${yearbookUrl ? `<a class="yearbook" href="${e(yearbookUrl)}">Submit yearbook entry</a>` : ''}
    </header>
    <main>
      <div class="intro"><h1>Twenty years on.</h1></div>
      <div class="layout">
        <figure>
          <img src="${photoUrl}" alt="IIM Ahmedabad Class of 2006 convocation group photograph" fetchpriority="high">
          <figcaption>Class of 2006 convocation · <a href="${photoUrl}">IIMA Archives</a></figcaption>
        </figure>
        <section class="card" aria-labelledby="sign-in-title">
          <h2 id="sign-in-title">Sign in</h2>
          <p class="instructions">Find your name and we’ll send a sign-in link to your email on the batch roster.</p>
          <label for="name-search">Find your name</label>
          <div class="search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4.2 4.2"/></svg>
            <input id="name-search" type="search" autocomplete="off" placeholder="Start typing your name" data-next="${e(next)}">
          </div>
          <ul id="name-results" aria-live="polite"></ul>
          ${selection}

        </section>
      </div>
    </main>
  </div>
  <script src="/picker.js" defer></script>
</body>
</html>`,{headers:{'Content-Type':'text/html; charset=utf-8'}});
}
