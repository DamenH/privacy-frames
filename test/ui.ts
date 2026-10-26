import { chromium } from 'playwright';
import { servers } from './server.ts';
const server = await servers();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  await page.goto('http://127.0.0.1:4210/privacy-frames/');
  await page.waitForFunction(
    () => document.querySelector('#status').textContent === 'Ready to install.',
  );
  for (const [id, port] of [
    ['notes', 4212],
    ['playground', 4217],
  ]) {
    await page.locator('#app-url').fill(`http://127.0.0.1:${port}/`);
    await page.locator('#install button').click();
    await page.locator(`[data-app="${id}"]`).waitFor();
  }
  await page.screenshot({ path: 'results/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'results/mobile.png', fullPage: true });
  const opened = page.context().waitForEvent('page');
  await page.locator('[data-app="playground"]').click();
  const app = await opened;
  await app.waitForFunction(() =>
    document.querySelector('#mode').textContent.includes('network isolated'),
  );
  await app.setViewportSize({ width: 1300, height: 1000 });
  await app.locator('#run').click();
  await app.waitForFunction(() =>
    document.querySelector('#output').textContent.includes('BLOCKED:'),
  );
  await app.screenshot({ path: 'results/playground.png', fullPage: true });
  console.log('Saved host desktop/mobile and confined playground screenshots.');
} finally {
  await browser.close();
  await server.close();
}
