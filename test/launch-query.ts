import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';
import { servers } from './server.ts';
import { testProvenance } from './provenance.ts';

const requests: string[] = [];
const publisher = createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://publisher.test');
  requests.push(request.url || '/');
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/app.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(
      "const parameters=new URLSearchParams(location.search);document.querySelector('#configuration').textContent=parameters.get('mode')+' '+parameters.get('text');",
    );
  } else if (url.pathname === '/') {
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<!doctype html><title>Query fixture</title><p id="configuration"></p><script src="app.js"></script>',
    );
  } else {
    response.writeHead(404);
    response.end('Missing');
  }
});
await new Promise<void>((resolve) => publisher.listen(0, '127.0.0.1', resolve));
const address = publisher.address();
if (!address || typeof address === 'string') throw new Error('Publisher address missing');
const query = '?mode=offline&text=a%26b';
const source = `http://127.0.0.1:${address.port}/${query}`;
const owned = process.env.HOST_URL ? undefined : await servers({ receiver: false });
const host = process.env.HOST_URL || 'http://127.0.0.1:4210/privacy-frames/';
const evidence = {
  provenance: await testProvenance(import.meta.url),
  browsers: [] as unknown[],
};
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(host);
      await page.getByText('Ready to install.', { exact: true }).waitFor();
      await page.locator('#app-url').fill(source);
      await page.locator('#install button').click();
      await page.waitForFunction(
        () =>
          /^(Installed |Installation refused:)/.test(
            document.querySelector('#status')?.textContent || '',
          ),
        {},
        { timeout: 60000 },
      );
      assert.match(await page.locator('#status').innerText(), /^Installed /);
      const link = page
        .locator('.app-card')
        .getByRole('link', { name: 'Open', exact: true });
      const href = await link.getAttribute('href');
      assert(href);
      assert.equal(new URL(href).search, query);
      const opened = context.waitForEvent('page');
      await link.click();
      const app = await opened;
      await app.getByText('offline a&b', { exact: true }).waitFor();
      assert.equal(new URL(app.url()).search, query);
      const manifest = await app.evaluate(async () => {
        const link = document.querySelector<HTMLLinkElement>('link[rel=manifest]');
        if (!link) throw new Error('Confined manifest missing');
        return (await (await fetch(link.href)).json()).start_url;
      });
      assert.equal(new URL(manifest, href).search, query);
      const captured = requests.length;
      await context.setOffline(true);
      await app.reload({ waitUntil: 'commit' });
      await app.getByText('offline a&b', { exact: true }).waitFor();
      assert.equal(new URL(app.url()).search, query);
      assert.equal(requests.length, captured);
      evidence.browsers.push({
        name,
        version: browser.version(),
        launch: href,
        sourceQuery: query,
        offlineReload: true,
        publisherRequestsAfterStartup: requests.length - captured,
      });
    } finally {
      await browser.close();
    }
  }
} finally {
  await owned?.close();
  await new Promise<void>((resolve, reject) =>
    publisher.close((error) => (error ? reject(error) : resolve())),
  );
  await writeFile(
    'results/contexts/launch-query.json',
    JSON.stringify(evidence, null, 2) + '\n',
  );
}
console.log(
  'Publisher query configuration preserved in launch, manifest and offline reload in both browsers',
);
