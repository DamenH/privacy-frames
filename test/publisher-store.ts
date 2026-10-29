import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from './build.ts';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';
const built = await build({
  stdin: {
    contents: `
import {PublisherStore} from ${JSON.stringify(resolve(import.meta.dirname, '../src/runtime/publisher/store.ts'))};
globalThis.runPublisherStore=async()=>{
 const owner={application:'app',generation:'generation'};
 const store=new PublisherStore('publisher-store-fixture');
 const independent=new PublisherStore('publisher-store-fixture');
 const source={script:'https://publisher.invalid/foreground.js',scope:'https://publisher.invalid/',type:'classic',lifecycleCompleted:true};
 const record=await store.register(owner,source);
 const same=await independent.register(owner,source);
 const checks={sameRegistration:record.id===same.id,callerCannotCompleteLifecycle:record.lifecycleCompleted===false};
 try{await store.register(owner,{...source,script:'https://publisher.invalid/other.js'});checks.changedSource=false;}catch{checks.changedSource=true;}
 const executor={...owner,registration:record.id,browserClient:'actual-shared-worker',contextId:crypto.randomUUID(),parentClient:'actual-window'};
 await store.bind(executor);
 const ticket=await store.grant(record,executor.parentClient);
 checks.foreignApp=await store.consume(ticket,{...executor,application:'other'})===undefined;
 checks.foreignGeneration=await store.consume(ticket,{...executor,generation:'other'})===undefined;
 checks.claimedClient=await store.consume(ticket,{...executor,browserClient:'claimed-id'})===undefined;
 const winners=await Promise.all([store.consume(ticket,executor),independent.consume(ticket,executor)]);
 checks.oneUse=winners.filter(Boolean).length===1;
 await store.activate(record.id,executor);
 checks.active=(await independent.byId(record.id)).state==='active';
 checks.completedLifecycle=(await independent.byId(record.id)).lifecycleCompleted===true;
 checks.reRegisterKeepsLifecycle=(await store.register(owner,source)).lifecycleCompleted===true;
 const replacement={...executor,browserClient:'new-native-worker',contextId:crypto.randomUUID()};
 await independent.bind(replacement);
 try{await store.activate(record.id,executor);checks.oldBinding=false;}catch{checks.oldBinding=true;}
 const oldTicket=await store.grant(record,executor.parentClient);
 checks.unregister=await store.unregister(owner);
 checks.oldTicket=await store.consume(oldTicket,replacement)===undefined;
 const next=await independent.register(owner,source);
 checks.closedIdNeverReused=next.id!==record.id;
 checks.newRegistrationNeedsLifecycle=next.lifecycleCompleted===false;
 checks.oldRegistration=await store.byId(record.id)===undefined;
 const fresh=await store.grant(next,replacement.parentClient);
 const nextExecutor={...replacement,registration:next.id};
 await store.bind(nextExecutor);
 checks.newGrant=!!await independent.consume(fresh,nextExecutor);
 return checks;
};`,
    resolveDir: import.meta.dirname,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2022',
});
const script = built.outputFiles[0].text;
const server = createServer((request, response) => {
  response.setHeader(
    'Content-Type',
    request.url === '/fixture.js' ? 'text/javascript' : 'text/html',
  );
  response.end(
    request.url === '/fixture.js'
      ? script
      : '<!doctype html><script src="/fixture.js"></script>',
  );
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('No server');
const browsers: object[] = [];
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${address.port}/`);
      const checks = await page.evaluate(() =>
        Reflect.get(window, 'runPublisherStore')(),
      );
      for (const [key, value] of Object.entries(checks)) assert.equal(value, true, key);
      browsers.push({ name, version: browser.version(), checks });
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise<void>((done) => server.close(() => done()));
  await mkdir(new URL('../results/contexts/', import.meta.url), { recursive: true });
  await writeFile(
    new URL('../results/contexts/publisher-store.json', import.meta.url),
    JSON.stringify(
      {
        date: new Date().toISOString(),
        bundleSHA256: createHash('sha256').update(script).digest('hex'),
        browsers,
      },
      null,
      2,
    ) + '\n',
  );
}
console.log(
  'Publisher registration lifetimes and actual executor grants pass both browsers.',
);
