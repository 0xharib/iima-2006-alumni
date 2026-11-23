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
const images=items=>items.length?`<div class="photos">${items.map(row=>`<figure><a href="/media/${e(row.media)}"><img src="/media/${e(row.media)}" loading="lazy" alt="${e(row.caption||'Batch photo')}"></a>${row.caption?`<figcaption>${e(row.caption)}</figcaption>`:''}</figure>`).join('')}</div>`:'<p>No published photos yet.</p>';
const portrait=(person,lazy=true)=>person.portrait
  ? `<img src="/media/${e(person.portrait)}" alt="" ${lazy?'loading="lazy"':''}>`
  : `<span class="initials" aria-hidden="true">${e(person.name.trim().split(/\s+/).slice(0,2).map(word=>word[0]).join(''))}</span>`;
const paths={like:'M20 8c0 4-8 9-8 9S4 12 4 8a4 4 0 0 1 8-1 4 4 0 0 1 8 1Z',comment:'M5 5h14v10h-7l-4 4v-4H5z',tag:'M4 5h9l7 7-7 7-9-9z M8 8h.1',edit:'m4 16 11-11 4 4-11 11H4z M13 7l4 4',close:'m6 6 12 12M18 6 6 18'};
const icon = (kind,label,attrs='') => `<button type="button" class="icon-action" aria-label="${e(label)}" title="${e(label)}" ${attrs}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[kind]}"/></svg></button>`;
const classmate = row => `<strong>${e(row.name)}</strong>${row.nickname?badge(row.nickname):''}${row.dorm?badge(/^\d+$/.test(row.dorm)?'Dorm '+row.dorm:row.dorm):''}`;
const card=(p,back)=>`<article><header>${link('/people/'+p.author,p.author_name)} <time datetime="${new Date(p.created).toISOString()}">${e(new Date(p.created).toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata'}))}</time></header>
  ${p.topic?link('/topics/'+p.topic,p.topic_title):''}${p.subject_name?`<small>About ${link('/people/'+p.subject,p.subject_name)}</small>`:''}
  ${p.feed_photo||p.has_legacy_photo?`<a class="feed-photos" href="/posts/${e(p.id)}"><img src="/media/${p.feed_photo?'post/'+e(p.feed_photo):'legacy/'+e(p.id)+'/1'}" alt="Yearbook memory photo" loading="lazy"></a>`:''}<p class="story">${e(p.body)}</p>${link('/posts/'+p.id,'Open memory')} ${action('/posts/'+p.id,'like',p.liked?'Unlike':'Like',{liked:p.liked?0:1,...(back?{return:back}:{})})} ${badge(p.likes+' likes')}</article>`;
const cards=(rows,back)=>rows.map(row=>card(row,back)).join('')||'<p>No memories here yet.</p>';

const memoryCards = (rows,priority=false) => rows.flatMap((post,index)=>{
  const photos=JSON.parse(post.collage_photos||'[]');
  const about=[...new Set([post.subject_name,post.topic_title,...JSON.parse(post.about_labels||'[]')].filter(Boolean))].join(', ');
  return (photos.length?photos:[null]).map(photo=>`<article class="collage-card${photo?'':' text-memory'}" data-post="${e(post.id)}">
    <div class="collage-visual">
      <button type="button" class="memory-enlarge" data-enlarge aria-label="View memory from ${e(post.author_name)}">
        ${photo?`<img src="/media/${e(photo)}" alt="Memory shared by ${e(post.author_name)}" decoding="async" ${priority&&index<3?'fetchpriority="high"':'loading="lazy"'}>`:`<span class="memory-quote">${e(post.body)}</span>`}
      </button>
      <div class="memory-credit"><a href="/people/${post.author}">${e(post.author_name)}</a>${about?` <span class="memory-about"><span aria-label="about">→</span> ${e(about)}</span>`:''}</div>
    </div>
    ${photo&&post.body&&post.body!=='Shared a yearbook photo.'?`<p class="memory-caption">${e(post.body)}</p>`:''}
    <div class="collage-actions">
      ${icon('like',post.liked?'Unlike':'Like','data-like aria-pressed="'+!!post.liked+'"')}<span data-count>${post.likes||''}</span>
      ${icon('comment','Comment','data-panel="comments" aria-expanded="false"')}
      ${icon('tag','Tag a classmate','data-panel="tags" aria-expanded="false"')}
    </div>
    <div class="memory-inline" data-panel-content="comments" hidden><div data-comments></div>
      <form data-social><textarea name="body" aria-label="Comment" placeholder="Write a comment…" maxlength="1200" required></textarea>
      ${field('action','comment')}<button>Post</button></form></div>
    <div class="memory-inline" data-panel-content="tags" hidden>
      <input type="search" data-tag-search aria-label="Find a classmate" placeholder="Name or dorm name" autocomplete="off">
      <div data-tag-results></div></div>
    <div class="memory-result" role="status"></div>
  </article>`);
}).join('');
const collage=(rows,next,priority=false)=>`<div class="memory-collage" data-feed>${memoryCards(rows,priority)||'<p>No memories here yet.</p>'}</div>
${next?`<a class="feed-more" data-feed-next href="${e(next)}">Load more</a>`:''}
<dialog class="memory-dialog" aria-label="Memory">${icon('close','Close','data-close')}<div data-dialog-content></div></dialog>`;
function socialInteractions(){
  const next=document.querySelector('[data-feed-next]');
  if(next&&'IntersectionObserver' in window){
    let loading=false;
    const observer=new IntersectionObserver(entries=>{
      if(entries.some(entry=>entry.isIntersecting)) loadMore();
    },{rootMargin:'500px'});
    async function loadMore(){
      if(loading)return;
      loading=true;
      observer.unobserve(next);
      try {
        const url=new URL(next.href);
        url.searchParams.set('fragment','1');
        const response=await fetch(url);
        if(!response.ok)throw new Error();
        const items=await response.json();
        document.querySelector('[data-feed]').insertAdjacentHTML('beforeend',items.html);
        if(items.next){next.href=items.next;observer.observe(next);}
        else next.remove();
      }catch{next.textContent='Retry loading memories';}
      finally{loading=false;}
    }
    next.addEventListener('click',event=>{event.preventDefault();loadMore();});
    observer.observe(next);
  }
  document.querySelector('[data-compose-open]')?.addEventListener('click',event=>{
    event.preventDefault();
    document.querySelector('.compose-dialog').showModal();
  });
  const addSelection=(form,value,label)=>{
    const list=form.querySelector('[data-topic-chips]');
    if([...list.querySelectorAll('input')].some(input=>input.value.toLowerCase()===value.toLowerCase()))return;
    const chip=document.createElement('span'), field=document.createElement('input');
    const name=document.createElement('span'), close=document.createElement('button');
    chip.className='topic-chip';field.type='hidden';field.name='about';field.value=value;
    name.textContent=label;
    close.type='button';close.dataset.removeTopic='';close.textContent='×';
    close.setAttribute('aria-label','Remove '+label);
    chip.append(field,name,close);list.append(chip);
  };
  const path = card => '/posts/'+encodeURIComponent(card.dataset.post);
  async function send(url,data){
    const response=await fetch(url,{method:'POST',body:data,headers:{Accept:'application/json'}});
    if(!response.ok) throw new Error(response.status===429?'Please wait and try again.':'Could not save. Try again.');
    return response;
  }
  function message(card,text){card.querySelector('.memory-result').textContent=text;}
  async function comments(card){
    const response=await fetch(path(card)+'?panel=comments');
    if(!response.ok) throw new Error('Could not load comments.');
    const list=card.querySelector('[data-comments]');
    const rows=await response.json();
    list.replaceChildren(...rows.map(row=>{
      const item=document.createElement('p'), name=document.createElement('strong');
      name.textContent=row.name;
      item.append(name,document.createTextNode(' '+row.body));
      return item;
    }));
  }
  document.addEventListener('click',async event=>{
    const button=event.target.closest('button');
    if(!button)return;
    if(button.matches('[data-upload]')){button.form.elements.photo.click();return;}
    if(button.matches('[data-close]')){button.closest('dialog').close();return;}
    const compose=button.closest('[data-compose]');
    if(compose){
      if(button.matches('[data-remove-topic]'))button.closest('.topic-chip').remove();
      if(button.matches('[data-target-option]')){
        addSelection(compose,button.dataset.targetOption,button.textContent);
        compose.querySelector('[data-target-search]').value='';
        button.parentElement.replaceChildren();
      }
      if(button.matches('[data-add-topic]')){
        const input=compose.querySelector('[data-new-topic]'), title=input.value.trim();
        if(title){addSelection(compose,'new:'+title,title);input.value='';input.closest('details').open=false;}
      }
    }
    const card=button.closest('[data-post]');
    if(!card)return;
    try {
      if(button.matches('[data-enlarge]')){
        if(card.closest('dialog'))return;
        const dialog=document.querySelector('.memory-dialog'), copy=card.cloneNode(true);
        copy.querySelector('img')?.removeAttribute('loading');
        dialog.querySelector('[data-dialog-content]').replaceChildren(copy);
        dialog.showModal();
      } else if(button.matches('[data-like]')){
        button.disabled=true;
        try {
          const data=new FormData();
          data.set('action','like');data.set('liked',button.getAttribute('aria-pressed')==='true'?'0':'1');
          const {liked,likes}=await (await send(path(card),data)).json();
          for(const other of document.querySelectorAll('[data-post="'+CSS.escape(card.dataset.post)+'"]')){
            const control=other.querySelector('[data-like]');
            control.setAttribute('aria-pressed',String(liked));
            control.setAttribute('aria-label',liked?'Unlike':'Like');
            control.title=liked?'Unlike':'Like';
            other.querySelector('[data-count]').textContent=likes||'';
          }
        } finally {button.disabled=false;}
      } else if(button.matches('[data-panel]')){
        const panel=card.querySelector('[data-panel-content="'+button.dataset.panel+'"]');
        panel.hidden=!panel.hidden;
        button.setAttribute('aria-expanded',String(!panel.hidden));
        if(!panel.hidden){
          panel.querySelector('input,textarea')?.focus();
          if(button.dataset.panel==='comments') await comments(card);
        }
      } else if(button.matches('[data-tag-id]')){
        button.disabled=true;
        try {
          const data=new FormData();
          data.set('action','tag-add');data.set('tag',button.dataset.tagId);
          await send(path(card),data);
          message(card,'Tag sent for approval.');
          button.closest('[data-panel-content]').querySelector('[data-tag-search]').value='';
          button.parentElement.replaceChildren();
        } finally {button.disabled=false;}
      }
    } catch(error){message(card,error.message);}
  });
  document.addEventListener('input',async event=>{
    const input=event.target;
    if(input.matches('[data-target-search]')){
      const results=input.form.querySelector('[data-target-results]'), q=input.value.trim();
      results.replaceChildren();
      if(!q)return;
      try{
        const response=await fetch('/memory-targets?q='+encodeURIComponent(q));
        if(!response.ok)throw new Error();
        const rows=await response.json();
        if(input.value.trim()!==q)return;
        results.replaceChildren(...rows.map(({value,label})=>{
          const option=document.createElement('button');
          option.type='button';option.dataset.targetOption=value;option.textContent=label;
          return option;
        }));
        if(!rows.length)results.textContent='No matches';
      }catch{if(input.value.trim()===q)results.textContent='Search unavailable.';}
      return;
    }
    if(!input.matches('[data-tag-search]'))return;
    const results=input.parentElement.querySelector('[data-tag-results]'), q=input.value.trim();
    results.replaceChildren();
    if(q.length<2)return;
    try {
      const response=await fetch('/tag-search?q='+encodeURIComponent(q));
      if(!response.ok)throw new Error('Search unavailable.');
      const rows=await response.json();
      if(input.value.trim()!==q)return;
      results.replaceChildren(...rows.map(row=>{
        const button=document.createElement('button');
        button.type='button';button.dataset.tagId=row.id;
        button.textContent=row.nickname?row.name+' · '+row.nickname:row.name;
        return button;
      }));
      if(!rows.length)results.textContent='No matches.';
    } catch(error){if(input.value.trim()===q)results.textContent=error.message;}
  });
  document.addEventListener('change',event=>{
    if(event.target.matches('[data-profile-edit] input[type=file]')&&event.target.files.length)event.target.form.requestSubmit();
  });
  document.addEventListener('submit',async event=>{
    const form=event.target;
    if(form.matches('.compose-dialog [data-compose]')){
      event.preventDefault();
      if(form.dataset.saving)return;
      form.dataset.saving='true';
      const status=form.querySelector('[data-compose-status]');
      const button=form.querySelector('button[type=submit]');
      button.disabled=true;
      try{
        const response=await fetch(form.action,{method:'POST',body:new FormData(form),headers:{Accept:'application/json'}});
        if(!response.ok)throw new Error(await response.text());
        const result=await response.json();
        const feed=document.querySelector('[data-feed]');
        if(!feed.querySelector('[data-post]'))feed.replaceChildren();
        feed.insertAdjacentHTML('afterbegin',result.html);
        form.reset();
        form.querySelector('[data-topic-chips]').replaceChildren();
        form.querySelector('[data-target-results]').replaceChildren();
        form.elements.id.value=crypto.randomUUID();
        status.textContent='';
        form.closest('dialog').close();
      }catch(error){status.textContent=error.message;}
      finally{delete form.dataset.saving;button.disabled=false;}
      return;
    }
    if(!form.matches('[data-social],[data-profile-edit]'))return;
    event.preventDefault();
    if(form.dataset.saving)return;
    form.dataset.saving='true';
    const card=form.closest('[data-post]');
    let status=form.querySelector('[data-edit-status]');
    try {
      const data=new FormData(form);
      if(card){
        await send(path(card),data);
        form.reset();
        await comments(card);
        message(card,'');
      }else{
        const response=await fetch(form.action,{method:'POST',body:data});
        if(!response.ok)throw new Error(await response.text());
        const next=new DOMParser().parseFromString(await response.text(),'text/html');
        const updated=next.querySelector('.alumni-profile');
        if(!updated)throw new Error('Could not update the profile. Try again.');
        document.querySelector('.alumni-profile').replaceWith(updated);
        const avatar=next.querySelector('.account summary');
        if(avatar)document.querySelector('.account summary').replaceWith(avatar);
      }
    }catch(error){
      if(card)message(card,error.message);
      else{
        if(!status){status=document.createElement('span');status.dataset.editStatus='';status.setAttribute('role','status');form.append(status);}
        status.textContent=error.message;
      }
    }finally{delete form.dataset.saving;}
  });
}
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
  .memory-nav{display:flex;flex-wrap:wrap;gap:.6rem 1.3rem;align-items:center;margin-bottom:1rem}.memory-feed{max-width:44rem}
  @media(max-width:600px){.directory-controls{grid-template-columns:1fr 1fr}.directory-controls label:first-child{grid-column:1/-1}}
  </style><body${home?' class="home"':''}><header class="bar"><div class="mast"><a class="wordmark" href="/"><img src="/campus/logo.png" alt="">IIMA Class of ’06</a>${nav}</div></header><main>${home?'':'<h1>'+e(title)+'</h1>'}${body}</main>${member?'<script src="/social.js" defer></script>':''}</html>`,{headers:{'Content-Type':'text/html; charset=utf-8'}});
}
export const page={
  socialScript: '('+socialInteractions.toString()+')();',
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
  home(rows,people,next,key){
    return `<div class="alumni-home"><section class="campus-hero"><div>
      <p class="class-label">IIM Ahmedabad · Class of 2006</p><h1>Twenty years on.</h1>
      <div class="hero-actions"><a class="cta" href="/people">Find classmates</a><a class="cta secondary" href="/reunion">Reunion</a></div>
      </div></section>
      <section class="home-classmates"><div class="section-head"><h2>Classmates</h2>${link('/people','See all →')}</div>
        <div class="people-grid">${people.map(row=>`<a class="person-tile" href="/people/${row.id}">${portrait(row)}<div>${classmate(row)}</div></a>`).join('')}</div>
      </section>
      <section class="home-memories"><div class="section-head"><h2>Memories</h2><div class="memory-nav"><a href="/compose" data-compose-open>Add your memory</a>${link('/memories','See all →')}</div></div>${collage(rows,next)}</section>
      <dialog class="memory-dialog compose-dialog" aria-label="Add your memory">${icon('close','Close','data-close')}<h2>Add your memory</h2>${page.compose(key)}</dialog>
    </div>`;
  },
  memories(rows,next){return `<div class="memory-nav">${link('/gallery','Gallery')}${link('/topics','Topics')}${link('/compose','Share a memory')}</div>
    ${collage(rows,next,true)}`;},
  gallery(photos){return `<div class="memory-nav">${link('/memories','Back to memories')}</div>${images(photos)}`;},
  memoryCards,
  directory(rows,statuses,q,status,dorms,dorm){return `<form class="directory-controls" method="get">${input('q','Name, nickname or dorm',q)}${select('status','Attendance',[['','All classmates'],...Object.entries(statuses)],status)}${dorms.length?select('dorm','Dorm',[['','All dorms'],...dorms.map(({dorm})=>[dorm,/^\d+$/.test(dorm)?'Dorm '+dorm:dorm])],dorm):''}<button>Apply filters</button></form>
    ${rows.length?`<div class="directory-grid">${rows.map(row=>`<a class="directory-card" href="/people/${row.id}">${portrait(row)}<div>${classmate(row)}${badge(statuses[row.status])}</div></a>`).join('')}</div>`:status==='attending'?'<p>No classmates are marked as attending for these filters.</p>':'<p>No classmates match.</p>'}`;},
  person(row,status,details,photos,stories,me,pilot){
    const own = me === row.id;
    const profileUrl = '/people/'+row.id;
    const received = stories.filter(post=>post.author!==row.id);
    const shared = stories.filter(post=>post.author===row.id);
    const facts = ['dorm','nickname','city','country','company','education','section','family'];
    const hasValue = key => typeof details[key]==='string' && details[key].trim();
    const factKeys = own ? facts : facts.filter(hasValue);
    const entryKeys = Object.keys(details).filter(key=>!facts.includes(key)&&key!=='displayName'&&(hasValue(key)||own));
    const linkedin = /^https:\/\/(?:www\.)?linkedin\.com\/in\//i.test(row.linkedin||'')
      ? `<a class="profile-secondary" href="${e(row.linkedin)}" rel="noreferrer">LinkedIn ↗</a>` : '';
    const edit = (key,label,value) => own ? `<details class="inline-edit"><summary aria-label="Edit ${e(label)}" title="Edit ${e(label)}">✎</summary>
      ${form('/profile',field('field',key)+area('value',label,value,'maxlength="4000"'),'Save','data-profile-edit')}</details>` : '';
    const entry = key => {
      const label = ({dorm:'Dorm number',nickname:'Dorm name'})[key] || labelFor(key);
      return `<div class="editable-field"><dt>${e(label)}</dt><dd>${e(details[key]||'—')}</dd>${edit(key,label,details[key])}</div>`;
    };
    return `<div class="alumni-profile">
      <header class="profile-header">
        <div class="profile-cover"></div>
        <div class="profile-identity">
          <div class="profile-portrait">${portrait(row,false)}
            ${own?`<form action="/profile" method="post" enctype="multipart/form-data" data-profile-edit>
              ${field('field','portraitObject')}<input type="file" name="photo" accept="image/jpeg,image/png" hidden>
              ${icon('edit','Upload profile photo','data-upload')}</form>`:''}</div>
          <div class="profile-name editable-field"><h1>${e(details.displayName||row.name)}</h1>
            ${edit('displayName','Name',details.displayName||row.name)}
            ${status?`<span class="profile-status">${e(status)}</span>`:''}
          </div>
          <div class="profile-actions">
            ${own?`<a class="profile-secondary" href="/yearbook">Review yearbook</a>`
              : `<a class="profile-primary" href="/compose?person=${row.id}">Add a memory</a>`}
            ${linkedin}
          </div>
        </div>
      </header>
      ${pilot?'<p class="profile-pilot">Profiles are being checked during the pilot.</p>':''}
      <div class="profile-layout${factKeys.length||photos.length?'':' profile-layout-wide'}">
        ${factKeys.length||photos.length?`<aside class="profile-sidebar">
          ${factKeys.length?`<section class="profile-section"><h2>About</h2><dl class="profile-facts">${factKeys.map(entry).join('')}</dl></section>`:''}
          ${photos.length?`<section class="profile-section profile-photos"><div class="profile-section-head"><h2>Photos</h2>
            <a href="/gallery?person=${row.id}">View all</a></div>${images(photos.slice(0,4))}</section>`:''}
        </aside>`:''}
        <div class="profile-main">
          ${entryKeys.length?`<section class="profile-section"><h2>Yearbook</h2><dl class="profile-entry">${entryKeys.map(entry).join('')}</dl></section>`:''}
          <section class="profile-section profile-memories"><h2>Memories from classmates</h2>
            ${received.length?cards(received,profileUrl):'<p class="profile-empty">No memories have been shared about this classmate yet.</p>'}
          </section>
          ${shared.length?`<section class="profile-section profile-memories"><h2>Memories shared</h2>${cards(shared,profileUrl)}</section>`:''}
        </div>
      </div>
      <div class="profile-report">${report('profile',row.id)}</div>
    </div>`;
  },
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
  compose(key,selected=[]){
    const chip = ({value,label}) => `<span class="topic-chip">${field('about',value)}<span>${e(label)}</span><button type="button" data-remove-topic aria-label="Remove ${e(label)}">×</button></span>`;
    return form('/compose',field('id',key)+area('body','Your memory','','maxlength="4000"')+
      `<div class="memory-targets"><label>About<input type="search" data-target-search placeholder="Find a classmate, place or topic" autocomplete="off"></label>
        <div data-target-results></div><div data-topic-chips>${selected.map(chip).join('')}</div>
        <details><summary>Add Topic +</summary><div class="add-topic"><input data-new-topic maxlength="100" aria-label="New topic" placeholder="Topic name"><button type="button" data-add-topic>Add</button></div></details>
      </div>
      <label>Photos<input type="file" name="images" accept="image/jpeg,image/png" multiple></label>
      <p data-compose-status role="status"></p>`,'Publish memory','enctype="multipart/form-data" data-compose');},
  post(item,comments,tags,photos,me){
    const url='/posts/'+item.id;
    return card(item)+images(photos)+
      (item.author===me?`<details><summary>Edit memory</summary>${form(url,field('action','edit')+area('body','Memory',item.body,'required'),'Save')}</details>${action(url,'delete','Delete memory')}`:'')+
      (item.subject===me||item.is_about_me?action(url,'unassociate','Remove from my profile'):'')+report('post',item.id)+
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
    .mark { display:grid; place-items:center; width:35px; height:35px; background:transparent; mix-blend-mode:multiply; border-radius:50%; padding:2px; object-fit:contain }
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
