import assert from 'node:assert/strict';
import { createHash, pbkdf2Sync } from 'node:crypto';
import type { Frame, Page, Worker } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';

const input = '[contenteditable=true]:not([aria-readonly=true])';
const output = '[contenteditable=true][aria-readonly=true]';

export interface CyberChefWorkers {
  started: string[];
  closed: string[];
  isClosed(worker: Worker): boolean;
}

export function observeCyberChefWorkers(page: Page): CyberChefWorkers {
  const closed = new WeakSet<Worker>();
  const observation: CyberChefWorkers = {
    started: [],
    closed: [],
    isClosed: (worker) => closed.has(worker),
  };
  page.on('worker', (worker) => {
    observation.started.push(worker.url());
    worker.on('close', () => {
      closed.add(worker);
      observation.closed.push(worker.url());
    });
  });
  return observation;
}

async function autoBake(page: Page, enabled: boolean) {
  if ((await page.locator('#auto-bake').isChecked()) !== enabled)
    await page.locator('#auto-bake-label').click();
  assert.equal(await page.locator('#auto-bake').isChecked(), enabled);
}

async function recipe(page: Page, name: string) {
  await page.locator('#clr-recipe').click();
  await page.locator('#search').fill(name);
  // CyberChef searches on keyboard events rather than the input event alone.
  await page.locator('#search').press('ArrowRight');
  assert.equal(
    await page.locator('#search-results .operation').first().textContent(),
    name,
  );
  await page.locator('#search').press('ArrowDown');
  await page.locator('#search').press('Enter');
  try {
    await page.locator('#rec-list .op-title').filter({ hasText: name }).waitFor();
  } catch (error) {
    throw new Error(
      'Recipe selection failed: ' +
        JSON.stringify({ name, recipe: await page.locator('#rec-list').innerHTML() }),
      { cause: error },
    );
  }
}

async function textInput(page: Page, value: string) {
  await page.locator(input).first().fill(value);
  await page.locator(input).first().press('ArrowRight');
  const addressValue = Buffer.from(value).toString('base64').replace(/=+$/, '');
  await page.waitForURL((url) => url.hash.includes('input=' + addressValue), {
    waitUntil: 'commit',
  });
}

async function expectOutput(page: Page, expected: string) {
  try {
    await page.waitForFunction(
      ({ selector, text }) => document.querySelector(selector)?.textContent === text,
      { selector: output, text: expected },
      { timeout: 30000, polling: 50 },
    );
    assert.equal(await page.locator(output).innerText(), expected);
  } catch (error) {
    const actual = await page.locator(output).innerText();
    throw new Error(
      'Unexpected CyberChef output: ' + JSON.stringify({ expected, actual }),
      { cause: error },
    );
  }
}

export async function cyberChefTextAndFile(page: Page) {
  await page.locator('#search').waitFor();
  await autoBake(page, true);
  const text = 'Privacy Frames: ordinary JavaScript, synthetic data.';
  await recipe(page, 'To Base64');
  await textInput(page, text);
  const encoded = Buffer.from(text).toString('base64');
  await expectOutput(page, encoded);
  await recipe(page, 'From Base64');
  await textInput(page, encoded);
  await expectOutput(page, text);

  const file = Buffer.from('Privacy Frames fixture line.\n'.repeat(100));
  await recipe(page, 'SHA2');
  await page.locator('[arg-name=Size]').selectOption({ label: '256' });
  await page.locator('#open-file').setInputFiles({
    name: 'fixture.txt',
    mimeType: 'text/plain',
    buffer: file,
  });
  const hash = createHash('sha256').update(file).digest('hex');
  await expectOutput(page, hash);
  return { textBytes: Buffer.byteLength(text), fileBytes: file.length, sha256: hash };
}

async function bombeFrame(page: Page): Promise<Frame | undefined> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      try {
        if (
          await frame.evaluate(
            () =>
              document.contentType === 'image/svg+xml' &&
              !!document.querySelector('.rotor'),
          )
        )
          return frame;
      } catch {
        // Pending native frames may replace their initial documents.
      }
    }
    await delay(50);
  }
  return undefined;
}

function bombeSnapshot(frame: Frame) {
  return frame.evaluate(() => {
    const rotor = document.querySelector<SVGGraphicsElement>('.rotor');
    if (!rotor) return null;
    const bounds = rotor.getBBox();
    return {
      contentType: document.contentType,
      width: bounds.width,
      height: bounds.height,
      transform: rotor.getAttribute('transform'),
    };
  });
}

export async function cyberChefCancelRestart(
  page: Page,
  workers: CyberChefWorkers,
  report: (stage: string, details: unknown) => void = () => {},
) {
  await autoBake(page, false);
  await textInput(page, 'synthetic work');
  await recipe(page, 'Derive PBKDF2 key');
  await page.locator('[arg-name=Passphrase]').fill('synthetic password');
  await page.locator('[arg-name=Salt]').fill('01020304');
  // First complete a small derivation through the same worker operation. This
  // separates execution cancellation from asynchronous operation-module loading.
  await page.locator('[arg-name=Iterations]').fill('1000');
  await page.locator('[arg-name=Iterations]').press('ArrowRight');
  await page.waitForURL(/1000/);
  await page.locator('#bake').click();
  const derivation = pbkdf2Sync(
    'synthetic password',
    Buffer.from('01020304', 'hex'),
    1000,
    16,
    'sha1',
  ).toString('hex');
  await expectOutput(page, derivation);
  // The previous bake removes its loading object on a delayed transition. Let
  // that transition finish before starting the operation whose animation we
  // observe, so its stale cleanup cannot remove the new loading indicator.
  await page.locator('#bombe').waitFor({ state: 'detached' });
  report('PBKDF2 output', { iterations: 1000, derivedKey: derivation });
  // A timed operation keeps the real recipe worker pending without imposing a
  // browser-specific CPU stress test. Cancellation must terminate that worker,
  // and the next recipe must still produce the expected output.
  await recipe(page, 'Sleep');
  await page.locator('[arg-name="Time (ms)"]').fill('10000');
  await page.locator('[arg-name="Time (ms)"]').press('ArrowRight');
  await page.waitForURL(/10000/);
  await page.waitForFunction(
    () => document.querySelector('#bake span')?.textContent?.trim() === 'Bake!',
    undefined,
    { polling: 50 },
  );
  let candidates: Worker[] = [];
  let cancelRequested = false;
  await page.locator('#bake').click();
  await page.waitForFunction(
    () => document.querySelector('#bake span')?.textContent?.trim() === 'Cancel',
    undefined,
    { polling: 50 },
  );
  report('Pending recipe', {
    recipe: await page.locator('#rec-list').innerText(),
    delay: await page.locator('[arg-name="Time (ms)"]').inputValue(),
  });
  let first = null;
  let animated = false;
  let animationFailure: unknown;
  try {
    await page.locator('#bombe').waitFor({ state: 'attached', timeout: 10000 });
    // Chromium exposes native object frames; other automation backends may not.
    // Absence is an unverified SVG observation, not an application failure claim.
    const frame = await bombeFrame(page);
    if (!frame) throw new Error('Native object SVG frame is not exposed to automation');
    first = await bombeSnapshot(frame);
    assert(first && first.width > 0 && first.height > 0);
    assert.equal(first.contentType, 'image/svg+xml');
    await frame.waitForFunction(
      (previous) => {
        const rotor = document.querySelector('.rotor');
        return !!rotor && rotor.getAttribute('transform') !== previous;
      },
      first.transform,
      { timeout: 3000, polling: 50 },
    );
    animated = true;
    report('SVG animation', first);
  } catch (error) {
    animationFailure = {
      message: error instanceof Error ? error.message : String(error),
      objects: await page.locator('#bombe').evaluateAll((elements) =>
        elements.map((element) => ({
          tag: element.tagName,
          source: element.getAttribute('data')?.slice(0, 60),
        })),
      ),
      loader: await page.locator('#output-loader').getAttribute('style'),
      frameCount: page.frames().length,
    };
    report('SVG animation failure', animationFailure);
  } finally {
    // Bound the pending native control even when the SVG prerequisite fails.
    if ((await page.locator('#bake span').textContent())?.trim() === 'Cancel') {
      candidates = page.workers();
      cancelRequested = true;
      await page.locator('#bake').click();
    }
  }
  assert(cancelRequested, 'Operation completed before Cancel could be exercised');
  await page
    .waitForFunction(
      () => document.querySelector('#bake span')?.textContent?.trim() === 'Bake!',
      undefined,
      { timeout: 5000, polling: 50 },
    )
    .catch(async (error) => {
      throw new Error(
        'After cancel button: ' +
          (await page.locator('#bake').evaluate((element) => element.outerHTML)),
        { cause: error },
      );
    });
  const closeDeadline = Date.now() + 3000;
  while (
    !candidates.some((worker) => workers.isClosed(worker)) &&
    Date.now() < closeDeadline
  )
    await delay(20);
  assert(
    candidates.some((worker) => workers.isClosed(worker)),
    'Cancel did not terminate an observed worker',
  );
  report('Worker cancellation', {
    terminatedWorkers: candidates.filter((worker) => workers.isClosed(worker)).length,
  });
  await autoBake(page, true);
  await recipe(page, 'To Base64');
  await page.locator('#open-file').setInputFiles({
    name: 'restart.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('restart confirmed'),
  });
  await expectOutput(page, Buffer.from('restart confirmed').toString('base64'));
  report('Restart output', { text: 'restart confirmed' });
  return {
    derivation,
    animated,
    animationFailure,
    geometry: first,
    terminatedWorkers: candidates.filter((worker) => workers.isClosed(worker)).length,
  };
}
