import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium, firefox } from 'playwright';
import { provideResourceList } from './resource-list-input.ts';
import { servers } from './server.ts';

// Real installer and runtime: scheme-like filenames must remain relative, and
// both they and ordinary nested resources must be served from installed bytes.
const paths = ['https:example.test', 'nested/resource.txt'];
const publisher = http.createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Cache-Control', 'no-store');
  const resource = paths.find((path) => request.url === '/' + path);
  if (resource) {
    response.setHeader('Content-Type', 'text/plain');
    response.end('captured:' + resource);
    return;
  }
  response.setHeader('Content-Type', 'text/html');
  response.end(`<!doctype html><title>Path fixture</title><output id="result"></output>
<script>
Promise.all(${JSON.stringify(paths)}.map(path => fetch('./' + path).then(r => r.text())))
  .then(values => document.querySelector('#result').textContent = values.join('|'))
  .catch(error => document.querySelector('#result').textContent = 'ERROR:' + error);
</script>`);
});
await new Promise<void>((resolve) => publisher.listen(0, '127.0.0.1', resolve));
const address = publisher.address();
assert(address && typeof address !== 'string');
const source = `http://127.0.0.1:${address.port}/`;
const host = await servers({ receiver: false });
try {
  for (const engine of [chromium, firefox]) {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext();
      const manager = await context.newPage();
      await manager.goto('http://127.0.0.1:4210/privacy-frames/');
      await manager.getByText('Ready to install.', { exact: true }).waitFor();
      await manager.locator('#app-url').fill(source);
      await provideResourceList(
        manager,
        paths.map((path) => source + path),
      );
      await manager.locator('#install button').click();
      await manager.waitForFunction(
        () =>
          /^(Installed |Installation refused:)/.test(
            document.querySelector('#status')!.textContent!,
          ),
        {},
        { timeout: 120000 },
      );
      assert.match((await manager.locator('#status').textContent())!, /^Installed /);
      const opened = context.waitForEvent('page');
      await manager.locator('.app-card [data-app]').first().click();
      const app = await opened;
      await app.waitForFunction(
        (expected) => document.querySelector('#result')?.textContent === expected,
        paths.map((path) => 'captured:' + path).join('|'),
        { timeout: 15000 },
      );
      await context.close();
      console.log(engine.name() + ': colon-named and nested installed resources loaded');
    } finally {
      await browser.close();
    }
  }
} finally {
  await host.close();
  publisher.closeAllConnections();
  await new Promise<void>((resolve) => publisher.close(() => resolve()));
}
