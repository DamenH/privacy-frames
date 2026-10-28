import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';
import { servers } from './server.ts';
import { testProvenance } from './provenance.ts';
const publisherOrigin = 'http://127.0.0.1:4360';
const receiverOrigin = 'http://127.0.0.1:4361';
const childCode = `
globalThis.popupBoot={host:privacyHost,shared:localStorage.getItem('popup-shared'),name:window.name,openerNull:window.opener===null,referrer:document.referrer};
window.addEventListener('message',event=>{
  if(event.data?.port){const port=event.data.port;port.onmessage=e=>port.postMessage('pong:'+e.data);port.start();port.postMessage({ready:true,bytes:Array.from(new Uint8Array(event.data.buffer))});}
});
globalThis.popupNested=target=>{const child=window.open('data:text/html,'+encodeURIComponent('<p>Nested prepared popup</p>'),'nested');const hidden=child.document===null;return new Promise((resolve,reject)=>{child.onerror=()=>reject(new Error('Nested popup failed'));child.onload=async()=>{let refused=false;try{await child.fetch(target+'/nested-popup-private-marker')}catch{refused=true}const value={hidden,host:child.privacyHost,shared:child.localStorage.getItem('popup-shared'),refused};child.close();resolve(value)}})};
globalThis.popupNetwork=async target=>{let fetchRefused=false,socketRefused=false,rtcRefused=false;try{await fetch(target+'/popup-private-marker')}catch{fetchRefused=true}try{new WebSocket(target.replace(/^http/,'ws')+'/popup-socket-marker')}catch{socketRefused=true}try{new RTCPeerConnection()}catch{rtcRefused=true}return{fetchRefused,socketRefused,rtcRefused}};
`;
const mainCode = `
localStorage.setItem('popup-shared','same-app-value');
const handles=new Map();
function popupSource(kind){
  if(kind==='installed')return 'child.html';
  if(kind==='empty')return 'about:blank';
  if(kind==='broken')return 'data:image/png,not-a-document';
  if(kind==='svg')return 'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" onload="setup(evt)"><script><![CDATA['+${JSON.stringify(childCode)}+';function setup(evt){const b=evt.currentTarget.querySelector("rect").getBBox();window.popupBBox={width:b.width,height:b.height}}]]></scr'+'ipt><rect width="10" height="12"/></svg>');
  const source='<p>Generated '+kind+'</p><script>'+${JSON.stringify(childCode)}+'</scr'+'ipt>';
  if(kind==='blob')return URL.createObjectURL(new Blob([source],{type:'text/html'}));
  return 'data:text/html,'+encodeURIComponent(source);
}
globalThis.popupFixture={
  create(kind='data',name='fixture',features=''){
    const old=handles.get(name),oldWindow=old&&!old.closed?old.document.defaultView:null;
    const source=popupSource(kind);const handle=window.open(source,name,features);
    if(kind==='blob')URL.revokeObjectURL(source);
    if(handle===null)return {nativeNull:true};
    handles.set(name,handle);
    const pending={documentNull:handle.document===null,noRTC:handle.RTCPeerConnection===undefined,noFunction:handle.Function===undefined,noDocumentDescriptor:Object.getOwnPropertyDescriptor(handle,'document')===undefined,ownKeys:Reflect.ownKeys(handle).length,reused:handle===old,previousClosed:old?old.closed:null,previousWindowClosed:oldWindow?oldWindow.closed:null};
    if(pending.reused)return {pending,host:handle.privacyHost,reused:true};
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Popup fixture timed out')),25000);
      handle.onerror=()=>{clearTimeout(timer);resolve({pending,error:true,closed:handle.closed});};
      handle.onload=()=>{clearTimeout(timer);resolve({pending,loaded:true,host:handle.privacyHost,boot:handle.popupBoot||null,contentType:handle.document.contentType,arrayConstructor:new handle.Array(2).length,windowPrepared:!!handle.document.defaultView.privacyHost,bbox:handle.popupBBox||null});};
    });
  },
  invalidPost(){const handle=window.open(popupSource('data'),'invalid');const buffer=new ArrayBuffer(1);let name;try{handle.postMessage({buffer},'invalid-origin',[buffer])}catch(error){name=error.name}handle.close();return{name,bytes:buffer.byteLength};},
  queue(){
    const handle=window.open(popupSource('data'),'queue');handles.set('queue',handle);
    const channel=new MessageChannel(),buffer=new Uint8Array([11,22]).buffer;
    const result=new Promise(resolve=>channel.port1.onmessage=e=>resolve(e.data));channel.port1.start();
    handle.postMessage({buffer,port:channel.port2},'*',[buffer,channel.port2]);
    return result.then(value=>({detached:buffer.byteLength===0,value}));
  },
  port(){const handle=handles.get('queue'),channel=new MessageChannel();return new Promise(resolve=>{channel.port1.onmessage=e=>{if(e.data?.ready)channel.port1.postMessage('value');else resolve(e.data)};channel.port1.start();handle.postMessage({buffer:new ArrayBuffer(0),port:channel.port2},'*',[channel.port2]);});},
  targets(target){const node=document.createElement('div');node.innerHTML='<a target="_blank" href="'+target+'/native-target-marker">Link</a><form target="_blank" action="'+target+'/form-target-marker"><button formtarget="_blank">Submit</button></form><svg><a target="_blank" href="'+target+'/svg-target-marker"><rect width="10" height="10"/></a></svg>';document.body.append(node);const a=node.querySelector('a'),form=node.querySelector('form'),button=node.querySelector('button'),svg=node.querySelector('svg a');const result={anchor:a.target,form:form.target,button:button.formTarget,svg:svg.target.baseVal};a.addEventListener('click',e=>e.stopImmediatePropagation());a.click();form.requestSubmit(button);node.remove();return result;},
  network(target){return handles.get('fixture').popupNetwork(target);},
  nested(target){return handles.get('fixture').popupNested(target);},
  cancel(){const handle=window.open(popupSource('data'),'cancel');handle.close();return {closed:handle.closed,documentNull:handle.document===null};},
  refused(target){try{window.open(target,'external');return false}catch{return true}},
  close(){for(const handle of handles.values())handle.close();handles.clear();},
};globalThis.popupFixtureReady=true;
`;
const files: Record<string, [string, string]> = {
  '/popups/': [
    'text/html',
    '<!doctype html><title>Popups</title><link rel="preload" href="child.html" as="fetch"><script src="main.js"></script><p>Popup fixture</p>',
  ],
  '/popups/main.js': ['text/javascript', mainCode],
  '/popups/child.html': [
    'text/html',
    '<!doctype html><title>Installed popup</title><script>' +
      childCode +
      '</script><p>Installed popup</p>',
  ],
};
const publisher = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  const file = files[new URL(req.url || '/', publisherOrigin).pathname];
  res.writeHead(file ? 200 : 404, { 'Content-Type': file?.[0] || 'text/plain' });
  res.end(file?.[1] || 'Missing');
});
const requests: string[] = [],
  connections: number[] = [];
const receiver = http.createServer((req, res) => {
  requests.push(req.url || '/');
  res.end('<!doctype html><title>Native control receiver</title>');
});
receiver.on('connection', () => connections.push(Date.now()));
await Promise.all([
  new Promise<void>((r) => publisher.listen(4360, '127.0.0.1', r)),
  new Promise<void>((r) => receiver.listen(4361, '127.0.0.1', r)),
]);
const local = await servers({ receiver: false });
const evidence = [];
try {
  for (const engine of [chromium, firefox]) {
    const browser = await launch(engine);
    const context = await browser.newContext();
    const logs: string[] = [];
    context.on('page', (p) => {
      p.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
      p.on('pageerror', (e) => logs.push('error: ' + e.message));
    });
    try {
      const native = await context.newPage();
      await native.goto(receiverOrigin + '/native-control');
      const controlPopup = context.waitForEvent('page');
      await native.evaluate(
        (target) => window.open(target, '_blank'),
        receiverOrigin + '/native-popup-control',
      );
      const control = await controlPopup;
      await control.waitForLoadState();
      assert(requests.includes('/native-popup-control'));
      const nativeInvalid = await native.evaluate(() => {
        const buffer = new ArrayBuffer(1);
        let name;
        try {
          window.postMessage({ buffer }, 'invalid-origin', [buffer]);
        } catch (error) {
          name = error.name;
        }
        return { name, bytes: buffer.byteLength };
      });
      await control.close();
      await native.close();
      requests.length = 0;
      connections.length = 0;
      const manager = await context.newPage();
      await manager.goto('http://127.0.0.1:4210/privacy-frames/');
      await manager.getByText('Ready to install.', { exact: true }).waitFor();
      await manager.locator('#app-url').fill(publisherOrigin + '/popups/');
      await manager.locator('#install button').click();
      await manager.waitForFunction(() =>
        /^(Installed |Installation refused:)/.test(
          document.querySelector('#status')?.textContent || '',
        ),
      );
      assert.match((await manager.locator('#status').textContent()) || '', /^Installed /);
      const opened = context.waitForEvent('page');
      await manager.locator('[data-app="popups"]').click();
      const app = await opened;
      await app.waitForFunction(() => Reflect.get(globalThis, 'popupFixtureReady'));
      const cases = [];
      for (const kind of ['data', 'blob', 'installed', 'svg', 'empty']) {
        const value = await app.evaluate(
          (kind) => Reflect.get(globalThis, 'popupFixture').create(kind),
          kind,
        );
        assert(value.loaded, JSON.stringify({ kind, value, logs }));
        for (const key of ['documentNull', 'noRTC', 'noFunction', 'noDocumentDescriptor'])
          assert.equal(value.pending[key], true, key);
        assert.equal(value.pending.ownKeys, 0);
        assert.equal(value.host.mode, 'network-isolated');
        assert.equal(value.windowPrepared, true);
        assert.equal(value.arrayConstructor, 2);
        if (kind !== 'empty') {
          assert.equal(value.boot.shared, 'same-app-value');
          assert.equal(value.boot.host.application, value.host.application);
        }
        if (cases.length) {
          assert.equal(value.pending.previousClosed, true);
          assert.equal(value.pending.previousWindowClosed, true);
        }
        if (kind === 'svg') assert.deepEqual(value.bbox, { width: 10, height: 12 });
        cases.push({ kind, value });
      }
      const repeat = await app.evaluate(() =>
        Reflect.get(globalThis, 'popupFixture').create('empty'),
      );
      assert.equal(repeat.reused, true);
      const invalidPost = await app.evaluate(() =>
        Reflect.get(globalThis, 'popupFixture').invalidPost(),
      );
      assert.deepEqual(invalidPost, nativeInvalid);
      const queued = await app.evaluate(() =>
        Reflect.get(globalThis, 'popupFixture').queue(),
      );
      assert.equal(queued.detached, true);
      assert.deepEqual(queued.value, { ready: true, bytes: [11, 22] });
      assert.equal(
        await app.evaluate(() => Reflect.get(globalThis, 'popupFixture').port()),
        'pong:value',
      );
      const network = await app.evaluate(async (target) => {
        await Reflect.get(globalThis, 'popupFixture').create('data');
        return Reflect.get(globalThis, 'popupFixture').network(target);
      }, receiverOrigin);
      assert.deepEqual(network, {
        fetchRefused: true,
        socketRefused: true,
        rtcRefused: true,
      });
      const pageCount = context.pages().length;
      const targets = await app.evaluate(
        (target) => Reflect.get(globalThis, 'popupFixture').targets(target),
        receiverOrigin,
      );
      assert.deepEqual(targets, {
        anchor: '_self',
        form: '_self',
        button: '_self',
        svg: '_self',
      });
      await app.waitForTimeout(100);
      assert.equal(context.pages().length, pageCount);
      const nested = await app.evaluate(
        (target) => Reflect.get(globalThis, 'popupFixture').nested(target),
        receiverOrigin,
      );
      assert.equal(nested.hidden, true);
      assert.equal(nested.shared, 'same-app-value');
      assert.equal(nested.host.mode, 'network-isolated');
      assert.equal(nested.refused, true);
      const refused = await app.evaluate(
        (target) => Reflect.get(globalThis, 'popupFixture').refused(target),
        receiverOrigin + '/uninstalled',
      );
      assert.equal(refused, true);
      const canceled = await app.evaluate(() =>
        Reflect.get(globalThis, 'popupFixture').cancel(),
      );
      assert.deepEqual(canceled, { closed: true, documentNull: true });
      const failed = await app.evaluate(() =>
        Reflect.get(globalThis, 'popupFixture').create('broken', 'broken'),
      );
      assert.equal(failed.error, true);
      assert.equal(failed.closed, true);
      await context.setOffline(true);
      const offline = await app.evaluate(() =>
        Reflect.get(globalThis, 'popupFixture').create('installed', 'offline'),
      );
      assert.equal(offline.loaded, true);
      await context.setOffline(false);
      const noOpenerPage = context.waitForEvent('page');
      const noOpener = await app.evaluate(() =>
        Reflect.get(globalThis, 'popupFixture').create(
          'data',
          'private',
          'noopener,noreferrer',
        ),
      );
      assert.equal(noOpener.nativeNull, true);
      const detached = await noOpenerPage;
      await detached.waitForFunction(() => Reflect.get(globalThis, 'popupBoot'));
      const detachedValue = await detached.evaluate(() =>
        Reflect.get(globalThis, 'popupBoot'),
      );
      assert.equal(detachedValue.openerNull, true);
      assert.equal(detachedValue.referrer, '');
      await detached.close();
      await app.evaluate(() => Reflect.get(globalThis, 'popupFixture').close());
      await app.waitForTimeout(200);
      assert.deepEqual(requests, []);
      assert.deepEqual(connections, []);
      evidence.push({
        browser: engine.name(),
        version: browser.version(),
        cases,
        queued,
        nativeInvalid,
        invalidPost,
        network,
        nested,
        targets,
        canceled,
        failed,
        offline,
        detachedValue,
        requests,
        connections,
        provenance: await testProvenance(import.meta.url),
      });
      console.log(engine.name() + ' confined popups passed.');
    } catch (error) {
      console.error(logs.slice(-70).join('\n'));
      throw error;
    } finally {
      await context.close();
      await browser.close();
    }
  }
} finally {
  await local.close();
  await Promise.all(
    [publisher, receiver].map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
  await mkdir('results/contexts', { recursive: true });
  await writeFile(
    'results/contexts/popups.json',
    JSON.stringify(evidence, null, 2) + '\n',
  );
}
