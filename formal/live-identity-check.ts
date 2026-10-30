import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// A fresh browser profile installs the public notes example. This checks the
// deployed policy and setup, not the seeded FedCM receiver counterexample.
const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  // These direct responses can seed origin-wide browser reporting state. This
  // samples deployed paths; it cannot inspect policies retained from older visits.
  for (const path of ['', 'connect.html', 'sw.js', 'guard.js']) {
    const direct = await context.request.get('https://apps.pf.damenh.com/' + path);
    assert.equal(direct.status(), 200, path);
    for (const header of ['report-to', 'reporting-endpoints', 'nel'])
      assert.equal(direct.headers()[header], undefined, `${path}: ${header}`);
  }
  const page = await context.newPage();
  await page.goto('https://pf.damenh.com/');
  await page.getByText('Ready to install.', { exact: true }).waitFor();
  await page.locator('#app-url').fill('https://privacy-frames.github.io/apps/notes/');
  await page.locator('#install button').click();
  await page.waitForFunction(
    () =>
      /^(Installed |Installation refused:)/.test(
        document.querySelector('#status')!.textContent!,
      ),
    {},
    { timeout: 120000 },
  );
  assert.match((await page.locator('#status').textContent())!, /^Installed /);
  const opened = context.waitForEvent('page');
  await page.locator('[data-app="notes"]').click();
  const app = await opened;
  await app.waitForFunction(() =>
    document.querySelector('#mode')?.textContent?.includes('network isolated'),
  );
  const result = await app.evaluate(() => {
    const ctor = Reflect.get(globalThis, 'IdentityCredential');
    if (!ctor?.disconnect) return 'unavailable';
    try {
      ctor.disconnect({
        configURL: location.origin + '/config.json',
        clientId: 'control',
        accountHint: 'account',
      });
      return 'not blocked synchronously';
    } catch (error) {
      return error instanceof Error ? error.name : 'unknown error';
    }
  });
  assert.equal(result, 'SecurityError');
  const response = await app.reload({ waitUntil: 'commit' });
  assert(
    response?.headers()['permissions-policy']?.includes('identity-credentials-get=()'),
  );
  for (const header of ['report-to', 'reporting-endpoints', 'nel'])
    assert.equal(response?.headers()[header], undefined, `application: ${header}`);
  assert(
    !/\breport-(?:to|uri)\b/i.test(response?.headers()['content-security-policy'] ?? ''),
  );
  console.log(
    `Live identity and sampled reporting-header checks passed in Chromium ${browser.version()}`,
  );
} finally {
  await browser.close();
}
