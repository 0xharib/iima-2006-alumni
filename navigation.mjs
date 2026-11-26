// Shared navigation shell for the alumni site and WhatsApp pages.
const destinations=[['/','Home','⌂'],['/memories','Memories','▧'],['/people','Classmates','♧'],['/reunion','Reunion','▦']];
const secondary=[['/photos-of-you','Photos of you'],['/remembering-sachin','In Memoriam · Sachin'],['/wa/','WhatsApp Insights']];
const paths={Home:'M3 10 12 3l9 7v11h-6v-7H9v7H3z',Memories:'M3 4h18v16H3z M3 16l6-6 5 5 3-3 4 4 M16 8h.1',Classmates:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-4-4 M16 3a4 4 0 0 1 0 8',Reunion:'M3 5h18v16H3z M3 10h18 M7 3v4 M17 3v4',More:'M3 6h18 M3 12h18 M3 18h18'};
const icon=label=>`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[label]}"/></svg>`;
const links=(current,mobile=false)=>destinations.map(([href,label])=>`<a href="${href}"${href===current?' aria-current="page"':''}>${mobile?icon(label)+'<span>'+label+'</span>':label}</a>`).join('');
const menu=(current,mobile)=>`<details class="nav-more"><summary${secondary.some(([href])=>href===current)?' aria-current="page"':''}>${mobile?icon('More'):''}<span>More</span></summary><div class="nav-more-panel"><strong>Explore our batch</strong>${secondary.map(([href,label])=>`<a href="${href}"${href===current?' aria-current="page"':''}>${label}</a>`).join('')}</div></details>`;
export const navigationLinks=current=>links(current)+secondary.map(([href,label])=>`<a class="nav-desktop-extra" href="${href}"${href===current?' aria-current="page"':''}>${href==='/remembering-sachin'?'In Memoriam':label}</a>`).join('')+menu(current,false);
export const mobileNavigation=current=>`<nav class="app-bottom-nav" aria-label="Mobile navigation">${links(current,true)}${menu(current,true)}</nav>`;
export const mobileNavCSS=String.raw`
body>nav.app-bottom-nav{display:none}
.nav-more{position:relative;margin:0}
.nav-more summary{list-style:none;cursor:pointer;margin:0}
.nav-more summary::-webkit-details-marker{display:none}
.nav-more-panel{position:absolute;right:0;top:100%;min-width:220px;padding:1rem;background:var(--paper);color:var(--ink);border:1px solid var(--line);border-radius:12px;box-shadow:0 10px 35px #0004;z-index:110}
.nav-more-panel strong{display:block;font-size:.78rem;text-transform:uppercase;letter-spacing:.08em;margin-bottom:.5rem}
.nav-more-panel a{display:block;padding:.7rem .4rem;color:var(--ink);text-decoration:none;border-radius:6px;white-space:normal}
.nav-more-panel a:hover,.nav-more-panel a[aria-current=page]{background:var(--tint);color:var(--brick)}
.nav-desktop-extra{display:none!important}
@media(min-width:1024px){
 .member-site .bar .mast{max-width:1440px;padding-inline:clamp(16px,2vw,32px)}
 .member-site .desktop-menu{gap:clamp(0px,.35vw,5px)}
 .member-site .desktop-menu>a{white-space:nowrap;padding-inline:clamp(5px,.8vw,12px)}
 .member-site .desktop-menu>.nav-desktop-extra{display:inline-flex!important}
 .member-site .desktop-menu>.nav-more{display:none}
}
.desktop-menu>.nav-more>summary{padding:.45rem .7rem;font:600 .88rem var(--sans)}
@media(max-width:650px){
 body.has-mobile-nav{padding-bottom:calc(66px + env(safe-area-inset-bottom,0px))}
 .member-site .desktop-menu,.member-site .mobile-menu{display:none}
 body>nav.app-bottom-nav{box-sizing:border-box;position:fixed;inset:auto 0 0;z-index:100;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));align-items:stretch;gap:0;width:100%;max-width:none;height:calc(66px + env(safe-area-inset-bottom,0px));margin:0;padding:0 env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);border:0;border-top:1px solid var(--concrete);border-radius:0;background:var(--paper);color:var(--ink);box-shadow:0 -4px 16px #0002;transform:none;filter:none;backdrop-filter:none;isolation:isolate}
 body>nav.app-bottom-nav>a,body>nav.app-bottom-nav .nav-more>summary{box-sizing:border-box;display:flex;flex-direction:column;gap:4px;align-items:center;justify-content:center;min-width:0;height:65px;margin:0;padding:3px 0;border:0;border-top:3px solid transparent;border-radius:0;color:var(--ink);background:transparent;text-decoration:none;font:600 .72rem/1.1 var(--sans);white-space:nowrap}
 body>nav.app-bottom-nav [aria-current=page],body>nav.app-bottom-nav details[open]>summary{color:var(--brick);border-top-color:var(--brick)}
 body>nav.app-bottom-nav .nav-more{position:static}
 body>nav.app-bottom-nav .nav-more-panel{position:absolute;inset:auto 0 100% 0;border-radius:20px 20px 0 0;padding:1.2rem 1.4rem;box-shadow:0 -12px 45px #0005;max-height:65vh;overflow:auto}
 body>nav.app-bottom-nav a:focus-visible,body>nav.app-bottom-nav summary:focus-visible{outline:2px solid var(--brick);outline-offset:-3px}
}
@media(max-width:360px){body>nav.app-bottom-nav>a,body>nav.app-bottom-nav .nav-more>summary{font-size:.65rem}}
@media print{body>nav.app-bottom-nav{display:none!important}body.has-mobile-nav{padding-bottom:0!important}}
`;
