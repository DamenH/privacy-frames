import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from './build.ts';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';
import { testProvenance } from './provenance.ts';

const appURL = 'https://apps.test/editor/';
const listURL = 'https://assets.test/editor.uri-list';
const built = await build({
  stdin: {
    contents: `import { createRoot } from 'react-dom/client'; import { App } from './src/manager/app.tsx';createRoot(document.getElementById('root')).render(<App/>);`,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2022',
  jsx: 'automatic',
  plugins: [
    {
      name: 'trusted-library-fixture',
      setup(build) {
        build.onResolve({ filter: /hooks\/use-library$/ }, () => ({
          path: 'library',
          namespace: 'fixture',
        }));
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: `globalThis.submittedRequests=[];export function useLibrary(){return{config:{examples:[{name:'Example editor',url:${JSON.stringify(appURL)},resourceListURL:${JSON.stringify(listURL)}}]},apps:[],ready:true,installing:false,status:{message:'Ready to install.',error:false},observations:'',install:async request=>{globalThis.submittedRequests.push(structuredClone(request));return true},remove:async()=>{},refresh:async()=>{},refreshObservations:async()=>{}}}`,
        }));
      },
    },
  ],
});
const server = http.createServer((request, response) => {
  response.setHeader(
    'Content-Type',
    request.url === '/app.js' ? 'text/javascript' : 'text/html',
  );
  response.end(
    request.url === '/app.js'
      ? built.outputFiles[0].contents
      : '<!doctype html><div id="root"></div><script src="/app.js"></script>',
  );
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address !== 'string');
const receipt = {
  provenance: await testProvenance(import.meta.url),
  scope:
    'Actual manager React UI with a trusted library stub; installer authentication and capture tested separately',
  browsers: [] as object[],
};
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(10000);
      page.on('pageerror', (error) => console.error(name, error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') console.error(name, message.text());
      });
      await page.goto('http://127.0.0.1:' + address.port);
      const source = page.locator('#app-url');
      await source.fill(appURL);
      assert.equal(await page.locator('#resource-list-url').inputValue(), listURL);
      assert(await page.locator('#resource-list-default').isVisible());
      await page.getByLabel('Resource list', { exact: true }).selectOption('none');
      await page.locator('#install button').click();
      await source.waitFor({ state: 'visible' });
      await page.waitForFunction(
        () => Reflect.get(window, 'submittedRequests').length === 1,
      );

      await page.getByRole('button', { name: 'Example editor', exact: true }).click();
      assert.equal(await page.locator('#resource-list-url').inputValue(), listURL);
      const override = 'https://custom.test/override.uri-list';
      await page.locator('#resource-list-url').fill(override);
      assert.equal(await page.locator('#resource-list-default').count(), 0);
      await page.locator('#install button').click();
      await page.waitForFunction(
        () => Reflect.get(window, 'submittedRequests').length === 2,
      );

      await page.getByRole('button', { name: 'Example editor', exact: true }).click();
      await page.getByLabel('Resource list', { exact: true }).selectOption('text');
      const text = '# Extra resources\nhttps://assets.test/image.png\n';
      await page.locator('#resource-list-text').fill(text);
      await page.locator('#install button').click();
      await page.waitForFunction(
        () => Reflect.get(window, 'submittedRequests').length === 3,
      );

      await page.getByRole('button', { name: 'Example editor', exact: true }).click();
      await page.getByLabel('Resource list', { exact: true }).selectOption('text');
      const uploaded = 'https://assets.test/uploaded.js\n';
      await page.locator('#resource-list-file').setInputFiles({
        name: 'resources.uri-list',
        mimeType: 'text/uri-list',
        buffer: Buffer.from(uploaded),
      });
      await page.waitForFunction(
        (text) =>
          document.querySelector<HTMLTextAreaElement>('#resource-list-text')?.value ===
          text,
        uploaded,
      );
      await page.locator('#install button').click();
      await page.waitForFunction(
        () => Reflect.get(window, 'submittedRequests').length === 4,
      );

      await page.getByRole('button', { name: 'Example editor', exact: true }).click();
      await page.getByLabel('Resource list', { exact: true }).selectOption('text');
      await page.locator('#resource-list-file').setInputFiles({
        name: 'large.uri-list',
        mimeType: 'text/uri-list',
        buffer: Buffer.alloc(256 * 1024 + 1, 97),
      });
      await page.getByRole('alert').waitFor();
      assert.match((await page.getByRole('alert').textContent()) || '', /256 KiB/);
      assert(await page.locator('#install button').isDisabled());
      await page.getByLabel('Resource list', { exact: true }).selectOption('none');
      assert(await page.locator('#install button').isEnabled());
      const submitted = await page.evaluate(() =>
        Reflect.get(window, 'submittedRequests'),
      );
      assert.deepEqual(submitted, [
        { url: appURL },
        { url: appURL, resourceList: { kind: 'url', url: override } },
        { url: appURL, resourceList: { kind: 'text', text } },
        { url: appURL, resourceList: { kind: 'text', text: uploaded } },
      ]);
      receipt.browsers.push({
        name,
        version: browser.version(),
        submitted,
        oversizeUploadRejected: true,
      });
      console.log(
        name,
        'manager URL/list selection, override, removal and upload passed',
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await mkdir('results', { recursive: true });
  await writeFile(
    'results/manager-installation.json',
    JSON.stringify(receipt, null, 2) + '\n',
  );
}
