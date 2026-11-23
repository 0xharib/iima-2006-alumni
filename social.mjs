export const socialScript = String.raw`
(function socialInteractions(){
  const next=document.querySelector('[data-feed-next]');
  if(next&&'IntersectionObserver' in window){
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
        const response=await fetch(url);
        if(!response.ok)throw new Error();
        const items=await response.json();
        document.querySelector('[data-feed]').insertAdjacentHTML('beforeend',items.html);
        if(items.next){next.href=items.next;next.classList.add('auto-feed');observer.observe(next);}
        else next.remove();
      }catch{next.classList.remove('auto-feed');next.textContent='Retry loading memories';}
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
    if(button.matches('[data-upload]')){button.form.querySelector('input[type=file]').click();return;}
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
})();
`;
