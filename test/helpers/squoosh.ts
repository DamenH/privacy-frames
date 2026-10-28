import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Page } from 'playwright';

/** Verify actual worker-backed encoding, rather than just the editor controls. */
export async function squooshImageTask(page: Page): Promise<string> {
  await page.waitForFunction(() => {
    const constructor = customElements.get('file-drop');
    const drop = document.querySelector('file-drop');
    return constructor && drop instanceof constructor;
  });
  const input = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d')!;
    const image = context.createImageData(256, 256);
    let seed = 0x12345678;
    for (let offset = 0; offset < image.data.length; offset += 4) {
      for (let channel = 0; channel < 3; channel++) {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        image.data[offset + channel] = seed & 255;
      }
      image.data[offset + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const source = Buffer.from(input, 'base64');
  await page.locator('input[type=file]').setInputFiles({
    name: 'synthetic-noise.png',
    mimeType: 'image/png',
    buffer: source,
  });
  const jpeg = page.locator('a[download="synthetic-noise.jpg"]');
  await jpeg.waitFor({ timeout: 30000 });
  await page.waitForFunction(
    () =>
      document
        .querySelector('a[download="synthetic-noise.jpg"]')
        ?.getAttribute('href')
        ?.startsWith('blob:'),
    {},
    { timeout: 30000 },
  );
  async function output() {
    const encoded = await page.evaluate(async () => {
      const link = document.querySelector<HTMLAnchorElement>(
        'a[download="synthetic-noise.jpg"]',
      );
      if (!link?.href.startsWith('blob:'))
        throw new Error('JPEG download is unavailable');
      const response = await fetch(link.href);
      const blob = await response.blob();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const bitmap = await createImageBitmap(blob);
      const width = bitmap.width,
        height = bitmap.height;
      bitmap.close();
      return {
        type: blob.type,
        width,
        height,
        base64: btoa(Array.from(bytes, (value) => String.fromCharCode(value)).join('')),
      };
    });
    const bytes = Buffer.from(encoded.base64, 'base64');
    assert.equal(encoded.type, 'image/jpeg');
    assert.equal(encoded.width, 256);
    assert.equal(encoded.height, 256);
    assert.deepEqual([...bytes.subarray(0, 3)], [255, 216, 255]);
    assert(bytes.length < source.length, 'JPEG must be smaller than the noise PNG');
    return { bytes, digest: createHash('sha256').update(bytes).digest('hex') };
  }
  const before = await output();
  assert(page.workers().length > 0, 'Encoding task must exercise a browser worker');
  const previousURL = await jpeg.getAttribute('href');
  const quality = page.locator('input[type=range][name=quality]').first();
  await quality.fill('50');
  await page.waitForFunction(
    (previous) => {
      const value = document
        .querySelector('a[download="synthetic-noise.jpg"]')
        ?.getAttribute('href');
      return value?.startsWith('blob:') && value !== previous;
    },
    previousURL,
    { timeout: 30000 },
  );
  const after = await output();
  assert.notEqual(
    after.digest,
    before.digest,
    'Quality change must produce different JPEG bytes',
  );
  return `Encoded 256×256 synthetic PNG (${source.length} bytes) to decodable JPEG (${before.bytes.length} bytes); quality 50 produced different JPEG bytes (${after.bytes.length} bytes) using a browser worker`;
}
