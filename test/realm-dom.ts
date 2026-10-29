import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'ts',
    contents: `
      import {createApplicationRealm} from './src/runtime/realms/index.ts';
      import {installDOMContract,createDOMContract} from './src/runtime/capabilities/dom-contract.ts';
      globalThis.startRealm = backend => {
        const originalDocumentPrototype = Object.getPrototypeOf(document);
        const root = document.querySelector('#app');
        const bridge=createDOMContract(root);
        const realm=createApplicationRealm(backend);
        const install=realm.evaluate('('+installDOMContract.toString()+')');
        install(bridge.call);
        realm.evaluate(\`
          var contract = {clicked:false,sameTarget:false,sameThis:false,windowIdentity:document.defaultView===window};
          var box=document.createElement('div');
          box.style.width='120px';box.style.height='32px';box.textContent='Prepared node';
          document.body.appendChild(box);
          var field=document.createElement('input');field.type='checkbox';document.body.appendChild(field);
          field.addEventListener('click',function(event){
            contract.clicked=true;contract.sameTarget=event.target===field;contract.sameThis=this===field;
            event.preventDefault();
            contract.reentrant=document.querySelector('input')===field;
          });
          contract.width=box.getBoundingClientRect().width;
          contract.nodeIdentity=document.querySelector('div')===box;
          contract.documentIdentity=box.ownerDocument===document;
          Array.prototype.__appExtension=1;
          void 0;
        \`);
        globalThis.readRealm=()=>JSON.parse(realm.evaluate('JSON.stringify(contract)'));
        globalThis.revokeRealm=()=>{
          bridge.revoke();let denied=false;
          try{realm.evaluate('field.textContent="after revocation";void 0')}catch{denied=true}
          realm.revoke();
          return{denied,hostPrototypeUnchanged:Object.getPrototypeOf(document)===originalDocumentPrototype,hostArrayUnaffected:Array.prototype.__appExtension===undefined};
        };
        return{backend:realm.backend};
      };
    `,
  },
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2022',
});
const server = http.createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/probe.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(bundle.outputFiles[0].text);
  } else {
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<!doctype html><input id="control" type="checkbox"><main id="app"></main><script src="/probe.js"></script>',
    );
  }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address !== 'string');
const rows = [];
try {
  for (const [engine, backend, args] of [
    [chromium, 'native', ['--js-flags=--harmony-shadow-realm']],
    [chromium, 'membrane', []],
    [firefox, 'membrane', []],
  ] as const) {
    const browser = await launch(engine, { args: [...args] });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${address.port}/`);
      await page.locator('#control').click();
      assert(
        await page.locator('#control').isChecked(),
        'Native checkbox control inactive',
      );
      const selected = await page.evaluate(
        (backend) => globalThis.startRealm(backend),
        backend,
      );
      assert.equal(selected.backend, backend);
      await page.locator('#app input').click();
      assert(
        !(await page.locator('#app input').isChecked()),
        'Guest cancellation arrived too late',
      );
      const result = await page.evaluate(() => globalThis.readRealm());
      assert.equal(result.width, 120);
      for (const key of [
        'clicked',
        'sameTarget',
        'sameThis',
        'windowIdentity',
        'nodeIdentity',
        'documentIdentity',
        'reentrant',
      ])
        assert.equal(result[key], true, key);
      const revoked = await page.evaluate(() => globalThis.revokeRealm());
      assert(
        revoked.denied && revoked.hostPrototypeUnchanged && revoked.hostArrayUnaffected,
      );
      rows.push({
        browser: engine.name(),
        version: browser.version(),
        backend,
        result,
        revoked,
      });
      console.log(JSON.stringify(rows.at(-1)));
    } finally {
      await browser.close();
    }
  }
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await mkdir('results/realms', { recursive: true });
  await writeFile('results/realms/dom.json', JSON.stringify({ rows }, null, 2) + '\n');
}
