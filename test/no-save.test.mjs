import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.mjs';

test('member pages block right-click, long-press and dragging on photos', async()=>{
  const {call,session}=fixture(); const ck=await session(2,'bbbb');
  const page=await (await call('/',ck)).text();
  const src=page.match(/src="(\/social\.js\?v=\d+)"/)[1];
  assert.notEqual(src,'/social.js?v=27');                         // new version, so browsers fetch the new script
  const script=await (await call(src)).text();
  assert.match(script,/addEventListener\('contextmenu',[^\n]*closest\('img'\)[^\n]*preventDefault/);
  assert.match(script,/addEventListener\('dragstart',[^\n]*closest\('img'\)[^\n]*preventDefault/);
  const css=page.match(/href="(\/[^"]*\.css[^"]*)"/)[1];
  assert.match(await (await call(css)).text(),/\.member-site img\{[^}]*-webkit-touch-callout:none/);
});
