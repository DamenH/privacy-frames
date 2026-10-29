import type { Page } from 'playwright';

/** Supply the same explicit URL list an application publisher would provide. */
export async function provideResourceList(page: Page, urls: string[]): Promise<void> {
  const details = page.locator('#resource-list-options');
  if (await details.evaluate((node) => node instanceof HTMLDetailsElement && !node.open))
    await details.locator('summary').click();
  await page.getByLabel('Resource list', { exact: true }).selectOption('text');
  await page.locator('#resource-list-text').fill(urls.join('\n'));
}
