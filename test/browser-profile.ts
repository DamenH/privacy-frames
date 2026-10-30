// Playwright deliberately relaxes storage privacy. Restore those browser
// protections for confinement tests instead of treating automation defaults as
// evidence that embedded and top-level state necessarily share a partition.
import type { BrowserType } from 'playwright';

type BrowserOptions = NonNullable<Parameters<BrowserType['launchPersistentContext']>[1]>;
let chromiumDisabled: string | undefined;
async function options(engine: BrowserType, extra: BrowserOptions = {}) {
  if (engine.name() === 'firefox')
    return {
      ...extra,
      firefoxUserPrefs: {
        'browser.contentblocking.features.standard':
          '-tp,tpPrivate,cookieBehavior5,-cm,-fp',
        'network.cookie.cookieBehavior': 5,
        'network.cookie.cookieBehavior.pbmode': 5,
        'privacy.partition.network_state': true,
        ...extra.firefoxUserPrefs,
      },
    };
  if (engine.name() !== 'chromium') return extra;
  if (!chromiumDisabled) {
    const probe = await engine.launch({
      executablePath: engine.executablePath(),
      args: ['--enable-automation'],
    });
    try {
      const session = await probe.newBrowserCDPSession();
      const { arguments: args } = await session.send('Browser.getBrowserCommandLine');
      chromiumDisabled = args.find((value) => value.startsWith('--disable-features='));
    } finally {
      await probe.close();
    }
  }
  if (!chromiumDisabled) throw new Error('Chromium disabled-feature defaults missing');
  if (extra.ignoreDefaultArgs === true)
    throw new Error('Confinement profile requires browser default arguments');
  const parts = chromiumDisabled
    .slice('--disable-features='.length)
    .split(',')
    .filter((name) => name !== 'ThirdPartyStoragePartitioning');
  return {
    ...extra,
    ignoreDefaultArgs: [...(extra.ignoreDefaultArgs || []), chromiumDisabled],
    args: [...(extra.args || []), '--disable-features=' + parts.join(',')],
  };
}
export async function launch(engine: BrowserType, extra: BrowserOptions = {}) {
  return engine.launch(await options(engine, extra));
}
export async function launchPersistent(
  engine: BrowserType,
  directory: string,
  extra: BrowserOptions = {},
) {
  return engine.launchPersistentContext(directory, await options(engine, extra));
}
