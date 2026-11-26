export const socialScript = String.raw`
(function socialInteractions(){
  // One request helper for the site's JavaScript: a deadline, a JSON check (an expired session returns
  // the sign-in page instead) and a readable message. Nothing is retried automatically: an aborted
  // request does not prove a write failed, so mutations leave the retry to the person.
  class RequestError extends Error{constructor(message,kind){super(message);this.kind=kind;}}
  async function request(url,{method='GET',body,timeout=15000,signal}={}){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
    signal?.addEventListener('abort',()=>controller.abort(),{once:true});
    let response;
    try{response=await fetch(url,{method,body,credentials:'same-origin',headers:{Accept:'application/json'},signal:controller.signal});}
    catch(error){
      if(signal?.aborted)throw error;
      throw new RequestError(method==='GET'?'Could not load. Check your connection and try again.':'We couldn’t confirm this was saved. Check, then try again if needed.','network');
    }finally{clearTimeout(timer);}
    if(response.status===429)throw new RequestError('Please wait a moment and try again.','rate');
    if(!response.ok){
      const text=(await response.text().catch(()=>'')).trim();
      throw new RequestError(text&&text.length<200&&!text.startsWith('<')?text:method==='GET'?'Could not load. Try again.':'Could not save. Try again.','server');
    }
    if(!response.headers.get('Content-Type')?.includes('application/json'))
      throw new RequestError('Your session may have ended. Sign in again, then try again.','session');
    return response.json();
  }
  // "Looking to catch up": search WIMWIans and add one with a normal form post.
  const meet=document.querySelector('[data-meet-picker]');
  if(meet){
    const box=meet.querySelector('[data-meet-search]'), list=meet.querySelector('[data-meet-results]'), add=meet.querySelector('[data-meet-add]');
    const picked=new Set((meet.dataset.picked||'').split(',').filter(Boolean));
    let revision=0, timer=0;
    let pending=null;
    box.addEventListener('input',()=>{clearTimeout(timer);pending?.abort();timer=setTimeout(async()=>{
      const request=++revision, q=box.value.trim(); list.replaceChildren(); if(q.length<2) return;
      const controller=pending=new AbortController(),deadline=setTimeout(()=>controller.abort(),8000);
      try{
        const rows=await (await fetch('/tag-search?q='+encodeURIComponent(q),{signal:controller.signal})).json(); clearTimeout(deadline); if(request!==revision) return;
        const fresh=rows.filter(row=>!picked.has(String(row.id)));
        if(!fresh.length){const p=document.createElement('p');p.className='meet-hint';p.textContent=rows.length?'Already on your list.':'No matching classmates.';list.append(p);return;}
        for(const row of fresh){const b=document.createElement('button');b.type='button';b.setAttribute('role','option');
          b.textContent=row.name+(row.nickname?' · '+row.nickname:'');
          b.addEventListener('click',()=>{add.elements.target.value=row.id;b.disabled=true;add.submit();});list.append(b);}
      }catch{clearTimeout(deadline);if(request!==revision)return;const p=document.createElement('p');p.className='meet-hint';p.textContent='Search unavailable. Try again.';list.append(p);}
    },180);});
  }
  // Classmates load 30 at a time; "Show more" appends the next page in place (a plain link without JS).
  document.addEventListener('click',async event=>{
    const more=event.target.closest('[data-directory-more]');if(!more)return;
    event.preventDefault();if(more.dataset.loading)return;
    more.dataset.loading='true';const label=more.textContent;more.textContent='Loading…';
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
    try{
      const url=new URL(more.href,location.href);url.searchParams.set('fragment','1');
      const response=await fetch(url,{headers:{Accept:'application/json'},signal:controller.signal});
      if(!response.ok||!response.headers.get('Content-Type')?.includes('application/json'))throw new Error();
      const {html,next}=await response.json();
      document.querySelector('.directory-grid')?.insertAdjacentHTML('beforeend',html);
      if(next){more.href=next;more.textContent=label;}else more.closest('.directory-more')?.remove();
    }catch{more.textContent='Couldn’t load more. Tap to try again.';}
    finally{clearTimeout(timeout);delete more.dataset.loading;}
  });
  // Completion links open and focus the exact required editor or photo control.
  const profile=document.querySelector('.alumni-profile');
  if(profile){
    const jumpRequired=key=>{
      let target=Array.from(profile.querySelectorAll('[data-required-field]')).find(node=>node.dataset.requiredField===key);
      target ||= profile.querySelector('[data-required-missing]');if(!target)return;
      for(let parent=target.parentElement;parent&&parent!==profile;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
      const editor=target.querySelector('.inline-edit');if(editor)editor.open=true;
      target.scrollIntoView({block:'center',behavior:'smooth'});
      const control=target.querySelector('textarea,input:not([type=hidden]):not([type=file]),button[data-upload]');control?.focus({preventScroll:true});
    };
    if(new URLSearchParams(location.search).get('complete')==='whatsapp')jumpRequired(location.hash.replace('#profile-field-',''));
    profile.addEventListener('click',event=>{const link=event.target.closest('[data-required-jump]');if(!link)return;event.preventDefault();jumpRequired(link.dataset.requiredJump);});
  }
  const reunionDetails=document.querySelector('.reunion-details-panel');
  if(reunionDetails){
    if(location.hash.startsWith('#reunion-details')||location.hash.startsWith('#reunion-children'))reunionDetails.open=true;
    document.querySelector('[data-reunion-details-open]')?.addEventListener('click',()=>{reunionDetails.open=true;});
  }
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  // Keep new completions at the start until the reader chooses to browse.
  const freshStrip=document.querySelector('[data-fresh-strip]');
  if(freshStrip){
    const controls=[...freshStrip.parentElement.querySelectorAll('[data-fresh-step]')];
    const update=()=>{
      const end=freshStrip.scrollWidth-freshStrip.clientWidth;
      for(const button of controls)button.disabled=Number(button.dataset.freshStep)<0?freshStrip.scrollLeft<=1:freshStrip.scrollLeft>=end-1;
    };
    const reset=()=>{freshStrip.scrollLeft=0;update();};
    const step=direction=>freshStrip.scrollBy({left:direction*freshStrip.clientWidth*.85,behavior:reducedMotion.matches?'instant':'smooth'});
    for(const button of controls)button.addEventListener('click',()=>step(Number(button.dataset.freshStep)));
    freshStrip.addEventListener('scroll',update,{passive:true});
    freshStrip.addEventListener('keydown',event=>{if(event.target===freshStrip&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();step(event.key==='ArrowRight'?1:-1);}});
    window.addEventListener('resize',update,{passive:true});
    window.addEventListener('pageshow',reset);
    reset();
  }
  for(const strip of document.querySelectorAll('[data-classmate-strip]')){
   if(!reducedMotion.matches){
    let visible=false, stopped=false, frame=0, last=0, position=0, direction=1;
    const stop=()=>{
      stopped=true;
      cancelAnimationFrame(frame);
      strip.classList.remove('is-drifting');
      observer.disconnect();
    };
    const tick=time=>{
      if(stopped||!visible||document.hidden)return;
      const edge=strip.scrollWidth-strip.clientWidth;
      if(edge>1){
        position+=direction*Math.min(time-last,50)*.025;
        if(position>=edge||position<=0)direction=position>=edge?-1:1;
        position=Math.min(edge,Math.max(0,position));
        strip.scrollLeft=position;
      }
      last=time;
      frame=requestAnimationFrame(tick);
    };
    const sync=()=>{
      cancelAnimationFrame(frame);
      if(stopped||!visible||document.hidden||strip.matches(':hover'))return;
      strip.classList.add('is-drifting');
      position=strip.scrollLeft;
      last=performance.now();
      frame=requestAnimationFrame(tick);
    };
    const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;sync();});
    observer.observe(strip);
    strip.addEventListener('pointerenter',sync);
    strip.addEventListener('pointerleave',sync);
    for(const event of ['pointerdown','wheel','focusin'])strip.addEventListener(event,stop,{once:true,passive:true});
    reducedMotion.addEventListener('change',stop,{once:true});
    document.addEventListener('visibilitychange',sync);
   }
  }
  const feed=document.querySelector('[data-feed]');
  const cards=feed?[...feed.querySelectorAll('.collage-card')]:[];
  const narrow=matchMedia('(max-width:490px)'), medium=matchMedia('(max-width:850px)');
  let columns=[];
  const columnCount=()=>narrow.matches?1:medium.matches?2:3;
  function arrange(){
    if(!feed||!cards.length)return;
    columns=Array.from({length:columnCount()},()=>{
      const column=document.createElement('div');
      column.className='memory-column';
      return column;
    });
    cards.forEach((card,index)=>columns[index%columns.length].append(card));
    feed.classList.add('memory-columns');
    feed.replaceChildren(...columns);
  }
  arrange();
  for(const query of [narrow,medium])query.addEventListener('change',()=>{
    if(columns.length!==columnCount())arrange();
  });
  const addBatch=(html,prepend=false)=>{
    const batch=document.createElement('template');
    batch.innerHTML=html;
    const incoming=[...batch.content.querySelectorAll('.collage-card')];
    if(!incoming.length)return;
    const start=cards.length;
    if(prepend){
      cards.unshift(...incoming);
      arrange();
    }else{
      cards.push(...incoming);
      if(!columns.length)arrange();
      else incoming.forEach((card,index)=>columns[(start+index)%columns.length].append(card));
    }
  };
  const next=document.querySelector('[data-feed-next]');
  if(next&&!next.closest('[inert]')&&'IntersectionObserver' in window){
    let loading=false;
    next.classList.add('auto-feed');
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
        const items=await request(url);
        addBatch(items.html);
        if(items.next){next.href=items.next;next.classList.add('auto-feed');observer.observe(next);}
        else next.remove();
      }catch{next.classList.remove('auto-feed');next.textContent='Retry loading memories';}
      finally{loading=false;}
    }
    next.addEventListener('click',event=>{event.preventDefault();loadMore();});
    observer.observe(next);
  }
  for(const trigger of document.querySelectorAll('[data-compose-open]')){
    trigger.addEventListener('click',event=>{
      const dialog=document.querySelector('.compose-dialog');
      if(!dialog)return;
      event.preventDefault();
      dialog.showModal();
    });
  }
  const drafts=new WeakMap();
  const draftDB=new Promise((resolve,reject)=>{
    const open=indexedDB.open('iima-album-drafts',1);
    open.onupgradeneeded=()=>{open.result.createObjectStore('drafts');open.result.createObjectStore('files');};
    open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);
  });
  draftDB.catch(()=>{});
  const draftKey=form=>document.querySelector('script[data-member]').dataset.member+':'+new URL(form.action).pathname+':'+location.search;
  async function draftStore(form,mode,value){
    const db=await draftDB;
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('drafts',mode==='get'?'readonly':'readwrite'),store=tx.objectStore('drafts');
      const op=mode==='get'?store.get(draftKey(form)):mode==='delete'?store.delete(draftKey(form)):store.put(value,draftKey(form));
      tx.oncomplete=()=>resolve(op.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
  }
  async function draftFile(form,id,file){
    const db=await draftDB;
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('files',file?'readwrite':'readonly'),store=tx.objectStore('files');
      const op=file?store.put(file,draftKey(form)+':'+id):store.get(draftKey(form)+':'+id);
      tx.oncomplete=()=>resolve(op.result);tx.onerror=()=>reject(tx.error);
    });
  }
  async function clearDraft(form){
    const db=await draftDB;
    await draftStore(form,'delete');
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('files','readwrite'),store=tx.objectStore('files'),prefix=draftKey(form)+':';
      const cursor=store.openCursor(IDBKeyRange.bound(prefix,prefix+'\uffff'));
      cursor.onsuccess=()=>{const c=cursor.result;if(c){c.delete();c.continue();}};
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
    });
  }
  const persistDraft=form=>{
    const d=drafts.get(form);if(!d||!d.ready||d.clearing)return Promise.resolve();
    if(!d.photos.length&&!form.elements.body.value.trim()&&!form.elements.title.value.trim())return clearDraft(form).catch(()=>{});
    const files=d.photos.filter(p=>p.file).map(p=>({id:p.id,file:p.file}));
    const value={photos:d.photos.map(({url,file,...photo})=>photo),cover:d.cover,id:form.elements.id.value,
      body:form.elements.body.value,title:form.elements.title.value,tags:form.querySelector('[data-topic-chips]').innerHTML,revision:form.elements.revision?.value};
    d.saves=(d.saves||Promise.resolve()).catch(()=>{}).then(async()=>{
      d.storedFiles ||= new Set();
      for(const photo of files)if(!d.storedFiles.has(photo.id)){await draftFile(form,photo.id,photo.file);d.storedFiles.add(photo.id);}
      await draftStore(form,'put',value);
    });
    d.saves.catch(()=>{form.querySelector('[data-compose-status]').textContent='Draft could not be saved on this device. Keep this page open to finish uploading.';});
    return d.saves;
  };

  const redrawPhotos=form=>{
    const draft=drafts.get(form);
    const {photos}=draft;
    const album=photos.length>1||form.hasAttribute('data-album-edit');
    const title=form.querySelector('[data-album-title]');
    title.hidden=!album;form.elements.title.required=album;
    form.querySelector('[data-cover-hint]').hidden=!album;
    form.querySelector('[data-photo-queue]').replaceChildren(...photos.map((photo,index)=>{
      const item=document.createElement('li'), preview=document.createElement('img');
      preview.src=photo.url;preview.alt=photo.file?.name||photo.name||"Album photo";preview.loading="lazy";
      if(album){
        const cover=document.createElement('button');
        cover.type='button';cover.className='cover-thumb';
        cover.setAttribute('aria-label','Set '+(photo.file?.name||photo.name||"Album photo")+' as cover');
        cover.setAttribute('aria-pressed',String(draft.cover===photo.id));
        cover.append(preview);
        if(draft.cover===photo.id){
          const badge=document.createElement('span');badge.textContent='Cover';cover.append(badge);
        }
        cover.onclick=()=>{draft.cover=photo.id;redrawPhotos(form);form.querySelectorAll('.cover-thumb')[index]?.focus();};
        item.append(cover);
      }else item.append(preview);
      const remove=document.createElement('button');
      remove.type='button';remove.className='remove-thumb';remove.textContent='×';
      remove.setAttribute('aria-label','Remove '+(photo.file?.name||photo.name||"Album photo"));
      remove.onclick=()=>{
        photos.splice(index,1);URL.revokeObjectURL(photo.url);
        if(draft.cover===photo.id)draft.cover=photos[0]?.id;
        redrawPhotos(form);
      };
      const selected=document.createElement('input');selected.type='checkbox';selected.checked=!!photo.selected;
      selected.setAttribute('aria-label','Select photo '+(index+1));selected.onchange=()=>{if(form.dataset.saving)return;photo.selected=selected.checked;persistDraft(form);};
      item.append(selected);
      for(const [label,offset] of [['Move earlier',-1],['Move later',1]]){
        const move=document.createElement('button');move.type='button';move.textContent=label;
        move.disabled=index+offset<0||index+offset>=photos.length;
        move.onclick=()=>{[photos[index],photos[index+offset]]=[photos[index+offset],photos[index]];redrawPhotos(form);};item.append(move);
      }
      const state=document.createElement('small');state.textContent=photo.existing?'Saved':photo.uploaded?'Uploaded':'Waiting to upload';item.append(state,remove);
      return item;
    }));
    persistDraft(form);
  };
  for(const composer of document.querySelectorAll('[data-compose]')){
    const initial=JSON.parse(composer.querySelector('[data-album-initial]')?.textContent||'{}');
    const d={photos:(initial.photos||[]).map(p=>({...p,url:'/media/post/'+p.id+'?w=96'})),cover:initial.cover||null,initialTags:composer.querySelector('[data-topic-chips]').innerHTML,ready:false};
    drafts.set(composer,d);
    if(composer.elements.body.dataset.initial)composer.elements.body.value=composer.elements.body.dataset.initial;
    const controls=[...composer.elements];controls.forEach(c=>c.disabled=true);
    const status=composer.querySelector('[data-compose-status]');
    d.loading=(async()=>{
      try{
        const saved=await draftStore(composer,'get');
        if(saved){
          d.photos=await Promise.all(saved.photos.map(async p=>{
            const file=p.existing?null:await draftFile(composer,p.id);
            if(!p.existing&&!p.uploaded&&!file)throw new Error('Draft file unavailable');
            return {...p,file,url:file?URL.createObjectURL(file):(p.existing?'/media/post/':'/compose/photo?id=')+p.id+(p.existing?'?w=96':'')};
          }));d.storedFiles=new Set(d.photos.filter(p=>p.file).map(p=>p.id));d.cover=saved.cover;
          composer.elements.id.value=saved.id;composer.elements.body.value=saved.body;composer.elements.title.value=saved.title;
          composer.querySelector('[data-topic-chips]').innerHTML=saved.tags;
          if(composer.elements.revision&&saved.revision)composer.elements.revision.value=saved.revision;
          status.textContent='Restored your unfinished draft. Continue adding photos or retry saving.';
        }
      }catch{status.textContent='Draft storage is unavailable. Keep this page open until you finish.';}
      finally{d.ready=true;controls.forEach(c=>c.disabled=false);redrawPhotos(composer);}
    })();
    new MutationObserver(()=>persistDraft(composer)).observe(composer.querySelector('[data-topic-chips]'),{childList:true});
    composer.addEventListener('input',()=>persistDraft(composer));
    composer.querySelector('[data-remove-selected]').onclick=()=>{
      if(composer.dataset.saving)return;
      d.photos=d.photos.filter(p=>{if(p.selected&&!p.existing)URL.revokeObjectURL(p.url);return !p.selected;});
      if(!d.photos.some(p=>p.id===d.cover))d.cover=d.photos[0]?.id;
      redrawPhotos(composer);
    };
  }
  const gallery=document.querySelector('[data-personal-gallery]');
  if(gallery){
    const form=gallery.querySelector('[data-gallery-form]'),select=form.querySelector('[data-gallery-select]'),cancel=form.querySelector('[data-gallery-cancel]'),remove=form.querySelector('[data-gallery-remove]'),status=form.querySelector('.gallery-selection-status');
    const checks=[...form.querySelectorAll('input[name=media]')];
    const update=()=>{const n=checks.filter(c=>c.checked).length;remove.disabled=!n||n>300;remove.textContent=n?'Remove selected ('+n+')':'Remove selected';status.textContent=n>300?'Select at most 300 photos at a time.':n?n+' selected':'';};
    const mode=on=>{gallery.classList.toggle('is-selecting',on);select.hidden=on;cancel.hidden=!on;remove.hidden=!on;checks.forEach(c=>{c.closest('label').hidden=!on;if(!on)c.checked=false;});update();if(on)checks[0]?.focus();else select.focus();};
    select.onclick=()=>mode(true);cancel.onclick=()=>mode(false);checks.forEach(c=>c.addEventListener('change',update));
    form.addEventListener('submit',event=>{if(!gallery.classList.contains('is-selecting')||remove.disabled)event.preventDefault();else if(!confirm('Remove these tags from your gallery? The original photos will remain.'))event.preventDefault();});
  }
  const viewer=document.querySelector('.album-viewer');
  if(viewer){
    const albumPhotos=[...document.querySelectorAll('[data-album-photo]')];
    let current=0, touchStart;
    const show=index=>{
      current=(index+albumPhotos.length)%albumPhotos.length;
      const photo=albumPhotos[current];
      const image=viewer.querySelector('img');
      // A display-sized variant fills the viewer; the original stays one tap away.
      image.srcset=photo.href+'?w=768 768w, '+photo.href+'?w=1200 1200w';image.src=photo.href+'?w=1200';image.alt=photo.querySelector('img').alt;
      const original=viewer.querySelector('[data-album-original]');if(original)original.href=photo.href;
      const memory=viewer.querySelector('[data-album-memory]');if(memory)memory.href=photo.dataset.memoryHref;
      viewer.querySelector('[role=status]').textContent=(current+1)+' of '+albumPhotos.length;
    };
    albumPhotos.forEach((photo,index)=>photo.addEventListener('click',event=>{
      event.preventDefault();if(gallery?.classList.contains('is-selecting')){const check=photo.closest('figure')?.querySelector('input');if(check){check.checked=!check.checked;check.dispatchEvent(new Event('change'));}return;}show(index);viewer.showModal();
    }));
    viewer.querySelector('[data-album-prev]').onclick=()=>show(current-1);
    viewer.querySelector('[data-album-next]').onclick=()=>show(current+1);
    viewer.addEventListener('keydown',event=>{
      if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
        event.preventDefault();show(current+(event.key==='ArrowRight'?1:-1));
      }
    });
    viewer.addEventListener('touchstart',event=>{touchStart=event.changedTouches[0].clientX;},{passive:true});
    viewer.addEventListener('touchend',event=>{
      const distance=event.changedTouches[0].clientX-touchStart;
      if(Math.abs(distance)>45)show(current+(distance<0?1:-1));
    },{passive:true});
  }
  const addSelection=(form,value,label)=>{
    const list=form.querySelector('[data-topic-chips]');
    if([...list.querySelectorAll('input')].some(input=>input.value.toLowerCase()===value.toLowerCase()))return;
    const chip=document.createElement('span'), field=document.createElement('input');
    const name=document.createElement('span'), close=document.createElement('button');
    chip.className='topic-chip';field.type='hidden';field.name='about';field.value=value;
    name.textContent=(value.startsWith('person:')?'@':'#')+label;
    close.type='button';close.dataset.removeTopic='';close.textContent='×';
    close.setAttribute('aria-label','Remove '+label);
    chip.append(field,name,close);list.append(chip);
  };
  const likeRequests=new Set();
  const updateLike=(id,liked,likes)=>{
    for(const card of document.querySelectorAll('[data-post="'+CSS.escape(id)+'"]')){
      const control=card.querySelector('[data-like]');
      control.setAttribute('aria-pressed',String(liked));
      control.setAttribute('aria-label',liked?'Unlike':'Like');
      control.dataset.tooltip=liked?'Unlike':'Like';
      card.querySelector('[data-count]').textContent=likes||'';
    }
  };
  const path = card => '/posts/'+encodeURIComponent(card.dataset.post);
  const send=(url,data)=>request(url,{method:'POST',body:data});
  function message(card,text){card.querySelector('.memory-result').textContent=text;}
  function clearTagEditing(root){
    root.querySelectorAll('[data-tag-chip-edit]').forEach(chip=>{
      const link=chip.querySelector('a');
      if(link&&!link.hasAttribute('data-photo-edit-only'))chip.replaceWith(link);
      else chip.remove();
    });
    root.querySelectorAll('[data-correct-tag],[data-photo-edit-only]').forEach(x=>x.remove());
  }
  async function editableTags(card){
    const panel=card.querySelector('[data-panel-content="tags"]');
    const list=card.querySelector('[data-memory-tags]');
    if(!list)return;
    clearTagEditing(list);
    if(panel.hidden)return;
    const photo=card.dataset.photoScope||'';
    const rows=await request(path(card)+'?panel=tags&photo='+encodeURIComponent(photo));
    if(card.dataset.singlePhoto){const extra=await request(path(card)+'?panel=tags&photo='+encodeURIComponent(card.dataset.singlePhoto));rows.push(...extra.map(row=>({...row,photo:card.dataset.singlePhoto})));}
    if(panel.hidden)return;
    for(const row of rows){
      let link=list.querySelector('a[href="/people/'+CSS.escape(String(row.member))+'"]');
      if(row.photo&&!link){let group=list.querySelector('.memory-tags');if(!group){group=document.createElement('div');group.className='memory-tags';list.append(group);}link=document.createElement('a');link.href='/people/'+row.member;link.textContent='@'+row.label;link.dataset.photoEditOnly='';group.append(link);}
      if(!link)continue;
      if(link.parentElement.hasAttribute('data-tag-chip-edit')){if(row.photo)link.parentElement.querySelector('button').dataset.alsoPhoto=row.photo;continue;}
      const remove=document.createElement('button');
      remove.type='button';remove.dataset.correctTag=row.member;if(row.photo)remove.dataset.correctPhoto=row.photo;remove.textContent='×';
      remove.style.cssText='padding:0 6px;min-width:24px;min-height:24px;border:0;background:transparent;color:inherit';
      remove.setAttribute('aria-label','Remove tag for '+row.label);
      const chip=document.createElement('span');chip.dataset.tagChipEdit='';chip.className='tag-chip-edit';link.before(chip);chip.append(link,remove);
    }
  }
  async function comments(card){
    const rows=await request(path(card)+'?panel=comments');
    const list=card.querySelector('[data-comments]');
    list.replaceChildren(...rows.map(commentElement));
  }
  function commentElement(row){
      const item=document.createElement('div'), name=document.createElement('strong');
      item.className='comment-row';
      name.textContent=row.name;
      item.append(name);
      if(row.canDelete){
        const menu=document.createElement('details'), trigger=document.createElement('summary'), actions=document.createElement('div');
        const remove=document.createElement('button');
        menu.className='comment-menu';
        trigger.textContent='⋯';
        trigger.setAttribute('aria-label','Comment options');
        remove.type='button';
        remove.dataset.deleteComment=row.id;
        remove.textContent='Delete comment';
        actions.append(remove);menu.append(trigger,actions);item.append(menu);
      }
      const body=document.createElement('p');
      body.textContent=row.body;
      item.append(body);
      return item;
  }
  document.addEventListener('click',async event=>{
    const button=event.target.closest('button');
    if(!button)return;
    if(button.matches('[data-upload]')){button.form.querySelector('input[type=file]').click();return;}
    if(button.matches('[data-close]')){button.closest('dialog').close();return;}
    const compose=button.closest('[data-compose]');
    if(compose){
      if(button.matches('[data-remove-topic]'))button.closest('.topic-chip').remove();
      if(button.matches('[data-target-option]')){
        addSelection(compose,button.dataset.targetOption,button.dataset.label);
        compose.querySelector('[data-target-search]').value='';
        compose.querySelector('[data-target-results]').replaceChildren();
      }

    }
    const card=button.closest('[data-post]');
    if(!card)return;
    try {
      if(button.matches('[data-enlarge]')){
        if(card.closest('dialog'))return;
        const dialog=document.querySelector('.memory-dialog'), copy=card.cloneNode(true);
        clearTagEditing(copy);
        copy.querySelectorAll('[data-panel-content]').forEach(panel=>panel.hidden=true);
        copy.querySelectorAll('[data-panel]').forEach(toggle=>toggle.setAttribute('aria-expanded','false'));
        const photo=copy.querySelector('[data-full-src]');
        if(photo){
          photo.removeAttribute('loading');
          // Enlarged memories use display-sized variants rather than downloading the original.
          photo.srcset=photo.dataset.fullSrc+'?w=768 768w, '+photo.dataset.fullSrc+'?w=1200 1200w';
          photo.sizes='100vw';
          photo.src=photo.dataset.fullSrc+'?w=1200';
        }
        dialog.querySelector('[data-dialog-content]').replaceChildren(copy);
        dialog.showModal();
      } else if(button.matches('[data-like]')){
        const id=card.dataset.post;
        if(likeRequests.has(id))return;
        const previous=button.getAttribute('aria-pressed')==='true';
        const count=Number(card.querySelector('[data-count]').textContent)||0;
        likeRequests.add(id);
        message(card,'');
        updateLike(id,!previous,Math.max(0,count+(previous?-1:1)));
        try {
          const data=new FormData();
          data.set('action','like');data.set('liked',previous?'0':'1');
          const {liked,likes}=await send(path(card),data);
          updateLike(id,liked,likes);
        } catch(error) {
          updateLike(id,previous,count);
          throw error;
        } finally {likeRequests.delete(id);}
      } else if(button.matches('[data-panel]')){
        const panel=card.querySelector('[data-panel-content="'+button.dataset.panel+'"]');
        panel.hidden=!panel.hidden;
        button.setAttribute('aria-expanded',String(!panel.hidden));
        if(!panel.hidden){
          if(button.dataset.panel==='comments'){
            panel.querySelector('form').hidden=false;
            panel.querySelector('[data-comment-again]').hidden=true;
          }
          if(button.dataset.panel!=='tags')panel.querySelector('input,textarea')?.focus();
          else button.blur();
          if(button.dataset.panel==='comments') await comments(card);
          if(button.dataset.panel==='tags') await editableTags(card);
        }else if(button.dataset.panel==='tags'){clearTagEditing(card);}
      } else if(button.matches('[data-comment-again]')){
        button.hidden=true;
        const form=button.parentElement.querySelector('form');
        form.hidden=false;
        form.querySelector('textarea').focus();
      } else if(button.matches('[data-delete-comment]')){
        button.disabled=true;
        try{
          const data=new FormData();
          data.set('action','delete-comment');data.set('comment',button.dataset.deleteComment);
          await send(path(card),data);
          await comments(card);
        } finally {button.disabled=false;}
      } else if(button.matches('[data-correct-tag]')){
        const target=button.dataset.correctTag;
        button.disabled=true;
        try{
          const data=new FormData();
          data.set('action','tag-correct');data.set('tag',target);
          if(button.dataset.correctPhoto||card.dataset.photoScope)data.set('photo',button.dataset.correctPhoto||card.dataset.photoScope);
          const {tags}=await send(path(card),data);
          if(button.dataset.alsoPhoto){const extra=new FormData();extra.set('action','tag-correct');extra.set('tag',target);extra.set('photo',button.dataset.alsoPhoto);await send(path(card),extra);}
          for(const rendered of document.querySelectorAll('[data-post="'+CSS.escape(card.dataset.post)+'"]')){
            if(rendered.dataset.photoScope===(button.dataset.correctPhoto||card.dataset.photoScope)){
              rendered.querySelector('[data-memory-tags]').innerHTML=tags;
              const panel=rendered.querySelector('[data-panel-content="tags"]');
              panel?.querySelectorAll('[data-correct-tag]').forEach(remove=>{
                if(remove.dataset.correctTag===target)remove.closest('.topic-chip')?.remove();
              });
            }
          }
          message(card,'Tag removed.');
          if(!card.querySelector('[data-panel-content="tags"]').hidden) await editableTags(card);
        }finally{button.disabled=false;}
      } else if(button.matches('[data-tag-id]')){
        const panel=card.querySelector('[data-panel-content="tags"]');
        const toggle=card.querySelector('[data-panel="tags"]');
        button.disabled=true;
        panel.hidden=true;
        clearTagEditing(card);
        toggle.setAttribute('aria-expanded','false');
        try {
          const data=new FormData();
          data.set('action','tag-add');data.set('tag',button.dataset.tagId);
          if(card.dataset.photoScope)data.set('photo',card.dataset.photoScope);
          const {tags}=await send(path(card),data);
          for(const rendered of document.querySelectorAll('[data-post="'+CSS.escape(card.dataset.post)+'"]')){
            if(rendered.dataset.photoScope===card.dataset.photoScope) rendered.querySelector('[data-memory-tags]').innerHTML=tags;
          }
          message(card,'Tag added.');
          panel.querySelector('[data-tag-search]').value='';
          panel.querySelector('[data-tag-results]').replaceChildren();
        }catch(error){
          panel.hidden=false;
          toggle.setAttribute('aria-expanded','true');
          throw error;
        }finally{button.disabled=false;}
      }
    } catch(error){message(card,error.message);}
  });
  document.addEventListener('input',async event=>{
    const input=event.target;
    if(input.matches('[data-target-search],[data-tag-search]')){
      const inCard=input.matches('[data-tag-search]');
      const results=inCard?input.parentElement.querySelector('[data-tag-results]'):input.form.querySelector('[data-target-results]');
      const q=input.value.trim();
      clearTimeout(input.searchTimer);
      input.searchRequest?.abort();
      results.replaceChildren();
      if(!q)return;
      input.searchTimer=setTimeout(async()=>{
      const controller=new AbortController();input.searchRequest=controller;
      try{
        const rows=await request('/memory-targets?q='+encodeURIComponent(q),{signal:controller.signal,timeout:8000});
        if(input.value.trim()!==q)return;
        const suggestion=({value,label,dorm})=>{
          const option=document.createElement('button');
          option.type='button';
          if(inCard)option.dataset.tagId=value;
          else option.dataset.targetOption=value;
          option.dataset.label=label;
          option.textContent=label+(dorm?' · Dorm '+dorm:'');
          return option;
        };
        for(const category of ['Classmates','Places','Events','Tags']){
          const matches=rows.filter(row=>row.category===category);
          if(!matches.length)continue;
          const group=document.createElement('div'), heading=document.createElement('strong');
          heading.textContent=category;group.append(heading,...matches.map(suggestion));results.append(group);
        }
        const label=q.replace(/^[@#]/,'').trim();
        if(!q.startsWith('@') && label && !rows.some(row=>!row.value.startsWith('person:') && row.label.toLowerCase()===label.toLowerCase())){
          const group=document.createElement('div');
          for(const type of ['place','event']){
            const option=suggestion({value:'new-'+type+':'+label,label});
            option.textContent='Create '+type+' tag “'+label+'”';group.append(option);
          }
          results.append(group);
        }
        if(!results.children.length)results.textContent='No matches';

      }catch(error){if(error.name!=='AbortError'&&input.value.trim()===q)results.textContent='Search unavailable.';}
      },150);
      return;
    }
  });
  document.addEventListener('change',event=>{
    if(event.target.matches('[data-compose] input[type=file]')){
      const picker=event.target, draft=drafts.get(picker.form);
      const status=picker.form.querySelector('[data-compose-status]');
      status.textContent='';
      for(const file of picker.files){
        if(draft.photos.length===300){status.textContent='An album can hold up to 300 photos.';break;}
        if(file.size>15*1024*1024){status.textContent='Each photo must be 15 MB or smaller.';continue;}
        const photo={id:crypto.randomUUID(),name:file.name,file,url:URL.createObjectURL(file),uploaded:false};
        draft.photos.push(photo);
        draft.cover ||= photo.id;
      }
      picker.value='';
      redrawPhotos(picker.form);
    }
    if(event.target.matches('[data-directory-filters] select'))event.target.form.requestSubmit();
  });
  document.addEventListener('submit',async event=>{
    const form=event.target;
    if(form.matches('form[action="/logout"]')){
      event.preventDefault();
      const button=form.querySelector('button[type="submit"]');
      if(form.dataset.saving)return;
      form.dataset.saving='true';button.textContent='Signing out…';button.disabled=true;
      let status=form.querySelector('[data-logout-status]');
      if(!status){status=document.createElement('p');status.dataset.logoutStatus='';status.setAttribute('role','alert');form.append(status);}
      status.textContent='';
      const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
      try{
        const response=await fetch('/logout',{method:'POST',credentials:'same-origin',headers:{Accept:'application/json'},signal:controller.signal});
        if(!response.ok)throw new Error('Sign-out failed');
        const result=await response.json();if(!result.signedOut)throw new Error('Sign-out not confirmed');
        location.replace('/signin?signed-out=1');
      }catch{
        status.textContent='Could not finish signing out. Please try again.';
      }finally{clearTimeout(timeout);delete form.dataset.saving;button.disabled=false;button.textContent='Log out';}
      return;
    }
    if(form.matches('[data-compose]')){
      event.preventDefault();
      if(form.dataset.saving)return;
      await drafts.get(form).loading;
      form.dataset.saving='true';
      const status=form.querySelector('[data-compose-status]');
      const button=form.querySelector('button[type=submit]');
      button.disabled=true;
      try{
        const draft=drafts.get(form), data=new FormData(form);
        await persistDraft(form).catch(()=>{});
        const progress=form.querySelector('[data-upload-progress]');progress.hidden=false;progress.max=draft.photos.length||1;progress.value=draft.photos.filter(p=>p.uploaded).length;
        data.delete('images');
        if(!draft.photos.length&&!String(data.get('body')).trim())throw new Error('Add a photo or write a memory.');
        const picker=form.elements.images;
        picker.disabled=true;
        form.querySelectorAll('input,textarea,button:not([type=submit])').forEach(control=>{control.disabled=true;});
        let done=draft.photos.filter(photo=>photo.uploaded).length;
        const pending=draft.photos.filter(photo=>!photo.uploaded);
        for(let start=0;start<pending.length;start+=3){
          status.textContent='Uploaded '+done+' of '+draft.photos.length+' photos…';
          const batch=await Promise.allSettled(pending.slice(start,start+3).map(async photo=>{
            const upload=new FormData();upload.set('photo',photo.file);
            // Each photo has a stable id, so pressing Publish again re-sends only photos not yet confirmed.
            await request('/compose/photo?id='+encodeURIComponent(photo.id),{method:'POST',body:upload,timeout:120000});
            photo.uploaded=true;done++;progress.value=done;status.textContent='Uploaded '+done+' of '+draft.photos.length+' photos…';await persistDraft(form).catch(()=>{});
            status.textContent='Uploaded '+done+' of '+draft.photos.length+' photos…';
          }));
          const failed=batch.find(result=>result.status==='rejected');
          if(failed)throw failed.reason;
        }
        for(const photo of draft.photos)data.append('photoId',photo.id);
        if(draft.cover)data.set('cover',draft.cover);
        status.textContent=form.hasAttribute('data-album-edit')?'Saving album…':'Publishing memory…';
        // The memory id is fixed per draft, so a retry after an unconfirmed publish never duplicates it.
        const result=await request(form.action,{method:'POST',body:data,timeout:30000});
        clearTimeout(draft.saveTimer);draft.clearing=true;await draft.saves?.catch(()=>{});await clearDraft(form).catch(()=>{});
        if(form.hasAttribute('data-album-edit')||!feed){location.assign(result.url);return;}
        if(!feed.querySelector('[data-post]'))feed.replaceChildren();
        addBatch(result.html,true);
        draft.photos.forEach(photo=>URL.revokeObjectURL(photo.url));
        draft.photos.length=0;draft.cover=null;
        form.reset();
        form.querySelector('[data-topic-chips]').innerHTML=draft.initialTags;
        form.querySelector('[data-target-results]').replaceChildren();
        form.elements.id.value=crypto.randomUUID();
        status.textContent='';draft.clearing=false;
        form.closest('dialog')?.close();

      }catch(error){status.textContent=error.message;}
      finally{delete form.dataset.saving;form.querySelectorAll('input,textarea,button').forEach(c=>c.disabled=false);redrawPhotos(form);}
      return;
    }
    if(form.matches('[data-profile-form]')){
      // Save the profile editor in place: one request, no page reload, typed text and focus kept.
      event.preventDefault();
      if(form.dataset.saving)return;
      form.dataset.saving='true';
      const button=form.querySelector('button[type=submit]');
      let status=form.querySelector('[data-profile-status]');
      if(!status){status=document.createElement('p');status.dataset.profileStatus='';status.setAttribute('role','status');status.setAttribute('aria-live','polite');button.after(status);}
      const uploading=Array.from(form.querySelectorAll('input[type=file]')).some(input=>input.files.length);
      status.setAttribute('role','status');status.className='profile-save-status is-saving';
      status.textContent=uploading?'Saving… uploading your photos':'Saving…';
      button.disabled=true;
      const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),uploading?120000:20000);
      try{
        let response;
        try{response=await fetch(form.action,{method:'POST',body:new FormData(form),headers:{Accept:'application/json'},credentials:'same-origin',signal:controller.signal});}
        catch{throw new Error('We couldn’t confirm the save. Your changes are still here; press Save profile again. Saving twice is safe.');}
        if(!response.ok)throw new Error((await response.text())||'Your profile could not be saved. Your changes are still here; try again.');
        if(!response.headers.get('Content-Type')?.includes('application/json'))
          throw new Error('Please sign in again in another tab, then press Save profile. Your changes are still here.');
        const state=await response.json();
        for(const check of state.checks){
          const row=form.querySelector('#profile-field-'+check.key);if(!row)continue;
          row.classList.toggle('profile-required-missing',!check.complete||(check.key==='life'&&state.lifeGenerated));
          if(check.key==='then'||check.key==='now'){
            const hint=row.querySelector('small');if(hint)hint.textContent=check.complete?'Photo added · choose a file to replace it':'Required to unlock';
            const photo=state.photos[check.key];
            if(photo){
              let figure=row.querySelector('figure');
              if(!figure){
                figure=document.createElement('figure');figure.style.margin='.65rem 0';
                figure.innerHTML='<a target="_blank" rel="noopener"><img alt="" style="width:auto;max-width:100%;height:auto;max-height:18rem;object-fit:contain"></a><figcaption>Current photo · tap to view full size</figcaption>';
                row.querySelector('label')?.before(figure);
              }
              const link=figure.querySelector('a'),image=figure.querySelector('img');
              link.href=photo.href;link.setAttribute('aria-label','View current '+check.key+' photo');
              image.alt='Your current '+(check.key==='then'?'Then (2006)':'Now (2026)')+' photo';
              if(image.getAttribute('src')!==photo.src)image.src=photo.src;
              const label=row.querySelector('label');if(label?.firstChild?.nodeType===3)label.firstChild.textContent='Replace photo';
            }
          }
        }
        if(state.portrait?.src){
          const preview=form.querySelector('[data-portrait-preview]');
          if(preview){let img=preview.querySelector('img');if(!img){img=document.createElement('img');img.alt='Your profile picture';preview.replaceChildren(img);}img.src=state.portrait.src;}
          const label=form.querySelector('.profile-photo-change span');if(label)label.textContent='Change photo';
        }
        if(!state.lifeGenerated)form.querySelector('#profile-field-life .profile-generated-review')?.remove();
        // Uploaded files are saved; clear them so a second save does not upload them again.
        form.querySelectorAll('input[type=file]').forEach(input=>{input.value='';});
        const left=state.missing.length;
        status.className='profile-save-status is-saved';
        status.replaceChildren(document.createTextNode(state.complete?'Saved. All seven essentials are complete: memories, WhatsApp Insights and catch-up names are unlocked. ':'Saved. '+left+' of '+state.checks.length+' essentials still needed. '));
        const view=document.createElement('a');view.href=state.profile;view.textContent='View your profile';status.append(view);
      }catch(error){
        status.className='profile-save-status is-error';
        status.setAttribute('role','alert');
        status.textContent=error.message;
      }finally{clearTimeout(timeout);delete form.dataset.saving;button.disabled=false;}
      return;
    }
    if(!form.matches('[data-social]'))return;
    event.preventDefault();
    if(form.dataset.saving)return;
    form.dataset.saving='true';
    const card=form.closest('[data-post]');
    let status=form.querySelector('[data-edit-status]');
    try {
      const data=new FormData(form);
      if(card){
        const list=card.querySelector('[data-comments]');
        const optimistic=commentElement({name:'You',body:String(data.get('body'))});
        list.append(optimistic);
        form.hidden=true;
        try{
          const {comment}=await send(path(card),data);
          optimistic.replaceWith(commentElement(comment));
          form.reset();
          form.parentElement.querySelector('[data-comment-again]').hidden=false;
          message(card,'');
        }catch(error){optimistic.remove();form.hidden=false;throw error;}
      }else{
        const response=await fetch(form.action,{method:'POST',body:data,headers:{Accept:'application/json'}});
        if(!response.ok)throw new Error(await response.text());
        if(response.headers.get('Content-Type')?.includes('application/json')){
          const {value}=await response.json();
          const editor=form.closest('details');
          editor.parentElement.querySelector('.field-display').textContent=value||'—';
          editor.open=false;
          return;
        }
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
})();
`;
