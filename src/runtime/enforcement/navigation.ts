import type { PolicyTools } from './native.ts';
import { internalArray, internalRecord } from '../../shared/primordials.ts';
import {
  applicationHistoryURL,
  isApplicationRoute,
} from '../../shared/application-navigation.ts';

interface NavigationOptions {
  documentURL?: string;
  applicationURL?: string;
  sourceURL?: () => string;
  open?: (url?: unknown, target?: unknown, features?: unknown) => Window | null;
}

/** Cancel document exits before application handlers can observe the event. */
export function installNavigationPolicy(
  tools: PolicyTools,
  options: NavigationOptions = internalRecord({}),
) {
  const { apply, descriptor, method, accessor, propertyOwner, deny, fail, str, array } =
    tools;
  const prevent = Event.prototype.preventDefault;
  const nativeAdd = EventTarget.prototype.addEventListener;
  const NativeURL = URL;
  const urlOrigin = descriptor(NativeURL.prototype, 'origin')!.get!;
  const urlPathname = descriptor(NativeURL.prototype, 'pathname')!.get!;
  const urlSearch = descriptor(NativeURL.prototype, 'search')!.get!;
  const nativeLocation = window.location;
  const locationHref = descriptor(nativeLocation, 'href')!.get!;
  const initialURL = new NativeURL(
    options.documentURL || apply(locationHref, nativeLocation, []),
  );
  const initialOrigin = apply(urlOrigin, initialURL, []);
  const initialPathname = apply(urlPathname, initialURL, []);
  const initialSearch = apply(urlSearch, initialURL, []);
  function sameAddress(target: URL): boolean {
    return (
      apply(urlOrigin, target, []) === initialOrigin &&
      apply(urlPathname, target, []) === initialPathname &&
      apply(urlSearch, target, []) === initialSearch
    );
  }
  const inDocument = (input: string) =>
    options.applicationURL
      ? isApplicationRoute(input, options.applicationURL)
      : sameAddress(new NativeURL(input));
  const nav = window.navigation;
  if (!nav || typeof NavigateEvent !== 'function')
    throw new Error('Navigation API required');
  const nativeDestination = descriptor(NavigateEvent.prototype, 'destination')!.get!;
  const nativeSameDocument = descriptor(
    NavigationDestination.prototype,
    'sameDocument',
  )!.get!;
  const nativeDestinationURL = descriptor(NavigationDestination.prototype, 'url')!.get!;
  apply(nativeAdd, nav, [
    'navigate',
    (event: NavigateEvent) => {
      const destination = apply(nativeDestination, event, []);
      if (
        !apply(nativeSameDocument, destination, []) ||
        !inDocument(apply(nativeDestinationURL, destination, []))
      )
        apply(prevent, event, []);
    },
    internalRecord({ capture: true }),
  ]);
  const modifier = internalArray(['ctrlKey', 'metaKey', 'shiftKey', 'altKey']).map(
    (k) => descriptor(MouseEvent.prototype, k)!.get!,
  );
  apply(nativeAdd, window, [
    'click',
    (e: MouseEvent) => {
      if (modifier.some((get) => apply(get, e, []))) apply(prevent, e, []);
    },
    internalRecord({ capture: true }),
  ]);
  for (const name of ['auxclick', 'contextmenu'])
    apply(nativeAdd, window, [
      name,
      (e: MouseEvent) => apply(prevent, e, []),
      internalRecord({ capture: true }),
    ]);
  // The browser's own rich-HTML insertion must not bypass parser admission.
  for (const name of ['paste', 'drop'])
    apply(nativeAdd, window, [
      name,
      (event: Event & { clipboardData?: DataTransfer; dataTransfer?: DataTransfer }) => {
        const transfer = event.clipboardData || event.dataTransfer;
        if (transfer && array(transfer.types || []).includes('text/html'))
          apply(prevent, event, []);
      },
      internalRecord({ capture: true }),
    ]);
  method(window, 'open', options.open || deny);
  method(window, 'print', deny);
  if (globalThis.DocumentPictureInPicture)
    method(DocumentPictureInPicture.prototype, 'requestWindow', deny);
  const pipOwner = propertyOwner(window, 'documentPictureInPicture');
  if (pipOwner)
    accessor(pipOwner, 'documentPictureInPicture', internalRecord({ get: deny }));
  method(Document.prototype, 'execCommand', deny);
  // Present the browser's cookie-disabled behavior without exposing its
  // origin-wide cookie jar. Writes have no native storage or HTTP effect.
  const documentCookie = propertyOwner(document, 'cookie');
  if (documentCookie)
    accessor(documentCookie, 'cookie', internalRecord({ get: () => '', set: () => {} }));
  const cookieEnabled = propertyOwner(navigator, 'cookieEnabled');
  if (cookieEnabled)
    accessor(cookieEnabled, 'cookieEnabled', internalRecord({ get: () => false }));
  const domain = propertyOwner(document, 'domain');
  if (domain) accessor(domain, 'domain', internalRecord({ get: deny, set: deny }));
  const cookieOwner = propertyOwner(window, 'cookieStore');
  if (cookieOwner) accessor(cookieOwner, 'cookieStore', internalRecord({ get: deny }));
  for (const key of ['open', 'write', 'writeln']) method(Document.prototype, key, deny);
  for (const key of ['back', 'forward', 'go']) method(History.prototype, key, deny);
  for (const key of ['pushState', 'replaceState'] as const) {
    const fn = History.prototype[key];
    method(
      History.prototype,
      key,
      function (this: History, state: unknown, title: unknown, url?: unknown) {
        let targetURL = url === undefined || url === null ? url : str(url);
        if (targetURL !== undefined && targetURL !== null) {
          if (options.applicationURL && options.sourceURL) {
            const mapped = applicationHistoryURL(
              targetURL,
              apply(locationHref, nativeLocation, []),
              options.applicationURL,
              options.sourceURL(),
            );
            if (!mapped) fail('History URL leaves the application namespace');
            targetURL = mapped;
          } else {
            const target = new NativeURL(
              targetURL,
              apply(locationHref, nativeLocation, []),
            );
            if (!sameAddress(target)) fail('Only fragment history is admitted');
          }
        }
        return apply(fn, this, [state, str(title), targetURL]);
      },
    );
  }

  for (const key of ['back', 'forward', 'traverseTo'])
    method(Navigation.prototype, key, deny);
}
