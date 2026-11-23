export const theme = `
:root{--paper:#f5f3ee;--tile:#fffdf8;--ink:#211e1b;--muted:#656058;--brick:#8e3e30;--line:#e8e1d6}
body{background:var(--paper)}a{color:inherit;text-decoration:none}a:hover{color:var(--brick)}a,button{transition:background-color .16s,color .16s,box-shadow .16s}
.bar{background:#faf8f3;border-bottom:1px solid var(--line)}.bar .mast,main,footer{max-width:1280px;padding-inline:clamp(16px,4vw,52px)}.mast{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 24px}.wordmark{display:flex;align-items:center;gap:10px;font:750 1rem system-ui,sans-serif}.wordmark img{width:39px;height:39px;aspect-ratio:1;object-fit:contain;background:white;padding:3px;border-radius:50%}
nav{margin:0;gap:3px;align-items:center}nav a{font-size:.86rem;padding:.48rem .68rem;border-radius:8px}nav a:hover{background:#eee6db}h1,h2,h3{letter-spacing:-.035em}article,fieldset,.panel{box-shadow:0 6px 24px #26201608;border-radius:16px}article a{font-weight:650}.plain li a:hover,figcaption a:hover{text-decoration:underline}
.home main{padding-top:20px}.home h1{margin:0;font-size:clamp(3.3rem,7.4vw,7rem);font-weight:500;line-height:.94;letter-spacing:-.073em}
.campus-hero{min-height:clamp(390px,47vw,560px);border-radius:27px;overflow:hidden;display:flex;align-items:end;color:#fffaf2;background:#201611 linear-gradient(90deg,#150d0ce8 0%,#160d0c99 37%,#170e1010 75%);background-image:linear-gradient(90deg,#150d0cee 0%,#160d0ca0 39%,#170e1020 78%),url('/campus/arches.webp');background-size:cover;background-position:center 53%;padding:clamp(24px,6vw,72px)}
.campus-hero p{margin:.9rem 0 1.35rem;font-size:1.06rem;color:#f3e4d9}.campus-hero .class-label{font-size:.78rem;letter-spacing:.14em;text-transform:uppercase;font-weight:700}.hero-actions{display:flex;flex-wrap:wrap;gap:9px}
.cta{display:inline-flex;align-items:center;min-height:42px;padding:.55rem .88rem;border-radius:9px;font-size:.88rem;font-weight:720;background:#fff3e1;color:#382016}.cta:hover{background:#fff;color:#632a20}.cta.secondary{background:#251916a8;border:1px solid #fff6;color:white;backdrop-filter:blur(8px)}
.home-links,.home-columns,.people-grid{display:grid;gap:16px}.home-links{grid-template-columns:repeat(3,minmax(0,1fr));margin:16px 0 34px}.shortcut{display:flex;flex-direction:column;justify-content:end;min-height:161px;padding:20px;border-radius:17px;background:#fffdf8;border:1px solid var(--line);box-shadow:0 8px 24px #24130809}.shortcut strong{font-size:1.18rem}.shortcut small{display:block;font-size:.84rem}.shortcut:hover{box-shadow:0 10px 26px #24130821}.shortcut.image{color:white;background-size:cover;background-position:center;border:0}.shortcut.image small{color:#f3e8e0}.shortcut.steps{background-image:linear-gradient(0deg,#201510f2,#251a1233),url('/campus/steps.webp')}.shortcut.light{background-image:linear-gradient(0deg,#201510f2,#251a1233),url('/campus/light.webp')}
.home-columns{grid-template-columns:minmax(0,1.45fr) minmax(0,1fr);align-items:start;gap:clamp(20px,4vw,48px)}.home-columns section{min-width:0}.section-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}.section-head a{color:var(--brick);font-weight:700;font-size:.83rem}.section-head h2{margin:.25rem 0 .6rem;font-size:clamp(1.6rem,3vw,2.15rem)}.people-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}.person-tile{display:block;background:var(--tile);border:1px solid var(--line);border-radius:14px;overflow:hidden}.person-tile img,.person-tile .initials{aspect-ratio:1.18;object-fit:cover;object-position:center 32%;border-radius:0}.person-tile .initials{display:grid;place-items:center;background:#e8dbcf;color:#6f4036;font-size:2rem}.person-tile strong{display:block;padding:.55rem .72rem;font-size:.91rem}.home article{margin:.5rem 0 .85rem}.home article .story{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:4;overflow:hidden}.soft-link{display:inline-block;background:#eae3d9;padding:.55rem .85rem;border-radius:9px;font-weight:700;font-size:.87rem}.feed-photos img{max-height:238px;object-fit:cover}
@media(max-width:760px){.mast{padding-block:10px}.mast nav{width:100%;overflow-x:auto;flex-wrap:nowrap;white-space:nowrap;padding:2px 2px 5px}.home-columns{grid-template-columns:1fr}.home-links{gap:8px;margin-bottom:25px}.shortcut{min-height:135px;padding:12px}.shortcut strong{font-size:.94rem}.shortcut small{font-size:.75rem}.campus-hero{border-radius:18px;background-position:55% center}.people-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:390px){.home-links{grid-template-columns:1fr}.shortcut{min-height:87px}.people-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}

.alumni-profile{--profile-card:#fffefa;--profile-border:#e8e0d5;max-width:1100px;margin:0 auto 2rem}
.profile-header,.profile-section{background:var(--profile-card);border:1px solid var(--profile-border);border-radius:22px;box-shadow:0 7px 26px #2c1d1208}
.profile-header{overflow:hidden}
.profile-cover{height:clamp(125px,22vw,260px);background:#38251e linear-gradient(110deg,#301b18aa,#42231d12);background-image:linear-gradient(110deg,#301b18a8,#42231d18),url('/campus/steps.webp');background-size:cover;background-position:center 53%}
.profile-identity{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:1.4rem;align-items:center;padding:0 clamp(1rem,3vw,2rem) 1.5rem}
.profile-portrait{position:relative;margin-top:-3.6rem;width:clamp(105px,15vw,177px);aspect-ratio:1;padding:5px;background:var(--profile-card);border-radius:25px;box-shadow:0 8px 24px #23130e28}
.profile-portrait img,.profile-portrait .initials{display:grid;place-items:center;width:100%;height:100%;aspect-ratio:1;object-fit:cover;object-position:center 34%;border-radius:20px;background:#e9d8c9;color:#704133;font-size:clamp(2.5rem,6vw,4.8rem);font-weight:700}
.alumni-profile .profile-name h1{font:750 clamp(1.8rem,4.6vw,3.4rem)/1.07 system-ui,sans-serif;letter-spacing:-.055em;margin:.65rem 0 .25rem;overflow-wrap:anywhere}
.profile-name p,.profile-pilot,.profile-empty{color:var(--muted);margin:.25rem 0}
.profile-status{display:inline-block;margin-top:.45rem;padding:.22rem .55rem;background:#f1e9de;border-radius:99px;font-size:.78rem;font-weight:650}
.profile-actions{display:flex;gap:.5rem;flex-wrap:wrap;justify-content:flex-end;padding-top:.7rem}
.profile-actions a{display:inline-flex;align-items:center;padding:.57rem .82rem;border-radius:9px;font-size:.86rem;font-weight:700;min-height:42px}
.profile-primary{background:var(--brick);color:#fff}.profile-primary:hover{background:#703027;color:#fff}.profile-secondary{border:1px solid var(--profile-border);background:#f7f3ed}
.profile-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.8fr);gap:1rem;margin-top:1rem;align-items:start}
.profile-sidebar,.profile-main{display:grid;gap:1rem;min-width:0}.profile-layout-wide{grid-template-columns:minmax(0,1fr)}
.profile-section{padding:clamp(1rem,2.8vw,1.65rem);min-width:0}
.profile-section h2{font:750 clamp(1.15rem,2.4vw,1.45rem)/1.2 system-ui,sans-serif;letter-spacing:-.035em;margin:0 0 1rem}
.profile-section-head{display:flex;justify-content:space-between;align-items:baseline;gap:.75rem}.profile-section-head a{font-size:.85rem;font-weight:700;color:var(--brick)}
.profile-facts,.profile-entry{margin:0;display:grid;gap:1rem}.profile-facts{grid-template-columns:repeat(auto-fit,minmax(min(115px,100%),1fr))}
.profile-facts dt,.profile-entry dt{font-size:.78rem;color:var(--muted);margin-bottom:.18rem}.profile-facts dd,.profile-entry dd{margin:0}
.profile-entry>div+div{border-top:1px solid var(--profile-border);padding-top:1rem}.profile-entry dd{line-height:1.65}
.profile-photos .photos{grid-template-columns:repeat(2,minmax(0,1fr));gap:.65rem}.profile-photos img{aspect-ratio:1}.profile-photos figcaption{overflow-wrap:anywhere}
.alumni-profile .profile-memories article{background:#faf6f0;box-shadow:none;border-color:var(--profile-border)}.alumni-profile .profile-memories .story{display:block;overflow:visible}
.profile-report{color:var(--muted);font-size:.86rem;margin-top:1rem}
@media(max-width:730px){.profile-identity{grid-template-columns:auto minmax(0,1fr);column-gap:1rem;row-gap:.55rem}.profile-portrait{margin-top:-2rem}.profile-actions{grid-column:1/-1;justify-content:start}.profile-layout{grid-template-columns:1fr}.profile-sidebar{grid-template-columns:repeat(auto-fit,minmax(min(230px,100%),1fr))}}

[hidden]{display:none!important}
.wordmark img{background:transparent;mix-blend-mode:multiply}
.home:has(.alumni-home) main{max-width:none;padding:0}
.alumni-home{background:#211812;color:#fff7ed}
.alumni-home .campus-hero{min-height:calc(100svh - 75px);border-radius:0;background-position:center;padding:clamp(24px,7vw,110px)}
.alumni-home .hero-actions{margin-top:1.6rem}
.alumni-home .section-head a{color:#ffe1c5}
.home-classmates,.home-memories{padding:clamp(24px,5vw,70px) clamp(16px,6vw,92px);background-size:cover;background-position:center}
.home-classmates{background-image:linear-gradient(120deg,#241813f1,#241813ac),url('/campus/steps.webp')}
.home-memories{background-image:linear-gradient(120deg,#221a16ed,#221a16b5),url('/campus/light.webp')}
.home-classmates .people-grid{grid-template-columns:repeat(6,minmax(0,1fr))}
.home-classmates .person-tile{position:relative;isolation:isolate;min-height:118px;background:#392921;border-color:#fff3;color:#fff}
.home-classmates .person-tile img,.home-classmates .person-tile .initials{aspect-ratio: .84}
.home-classmates .person-tile>div{position:absolute;inset:auto 0 0;padding:.95rem .65rem .55rem;background:linear-gradient(transparent,#19120ff5)}
.home-classmates .person-tile strong,.home-classmates .person-tile small{display:block;padding:0;color:#fff;overflow-wrap:anywhere}
.home-classmates .person-tile small{font-size:.72rem;color:#f8e7d6}
.memory-collage{columns:3;column-gap:clamp(.65rem,2vw,1.25rem)}
.memory-collage .collage-card,.memory-dialog .collage-card{break-inside:avoid;margin:0 0 1rem;padding:0;overflow:hidden;color:#251a16;background:#fffaf3;box-shadow:0 8px 24px #21181116}
.collage-visual{position:relative}
.memory-enlarge{display:block;width:100%;margin:0;padding:0;background:none;color:inherit;border-radius:0;text-align:left}
.memory-enlarge img{width:100%;height:auto;aspect-ratio:auto;object-fit:contain;border-radius:0}
.memory-credit{position:absolute;bottom:.45rem;left:.55rem;max-width:calc(100% - 1rem);padding:.2rem .5rem;border-radius:.4rem;background:#1f1612e8;color:#fff;font-size:.81rem}
.memory-credit:hover{color:#ffe1c5}
.memory-quote{display:block;margin:.85rem .85rem 2.5rem;padding:1.15rem;border:1px solid #dcc4b1;background:#f2e5d6;font:1.12rem/1.48 Georgia,serif;white-space:pre-wrap;overflow-wrap:anywhere}
.memory-caption{padding:0 .75rem;white-space:pre-wrap;overflow-wrap:anywhere}
.compact-collage .memory-caption{display:none}
.compact-collage .memory-quote{max-height:9rem;overflow:hidden}
.collage-actions{display:flex;gap:.3rem;align-items:center;padding:.25rem .55rem}
.icon-action{display:inline-grid;place-items:center;width:2.4rem;height:2.4rem;padding:0;margin:0;background:transparent;color:#713b31;border-radius:50%}
.icon-action:hover,.icon-action[aria-expanded=true]{background:#f0e2d3}
.icon-action svg{width:1.25rem;height:1.25rem}
.icon-action[aria-pressed=true] svg{fill:currentColor}
.collage-actions [data-count]{font-size:.8rem}
.memory-inline,.memory-result{padding:.4rem .75rem;color:#503c36}
.memory-result:empty{display:none}
.memory-inline textarea{min-height:3rem}
.memory-inline [data-tag-results] button{display:block;margin:.25rem 0}
.memory-dialog{width:min(94vw,860px);max-height:94dvh;border:0;border-radius:16px;padding:.6rem;background:#fffaf3}
.memory-dialog::backdrop{background:#140e0cce}
.memory-dialog>[data-close]{display:grid;margin:0 0 .35rem auto}
.memory-dialog .collage-card{margin:0}
.memory-dialog img{max-height:65dvh;width:100%;height:auto;background:#211812}
.memory-dialog .memory-enlarge{cursor:default}
.editable-field{position:relative;padding-right:1.5rem;min-width:0}
.inline-edit summary{position:absolute;right:0;top:0;margin:0;list-style:none;color:#753a2e;padding:0 .25rem;font-size:1rem}
.inline-edit summary::-webkit-details-marker{display:none}
.inline-edit form{margin-top:.65rem}
.profile-portrait [data-upload]{position:absolute;right:8px;top:8px;background:#fff;color:#753a2e;box-shadow:0 2px 8px #251a1635}
.profile-portrait [data-edit-status]{position:absolute;top:100%;left:0;z-index:1;background:#fff;padding:.2rem;font-size:.8rem}
@media(max-width:850px){.memory-collage{columns:2}.home-classmates .people-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:490px){.memory-collage{columns:1}.home-classmates .people-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;
