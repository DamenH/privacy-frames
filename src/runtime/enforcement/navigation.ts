import type { PolicyTools } from './native.ts';

/** Cancel document exits before application handlers can observe the event. */
export function installNavigationPolicy(tools: PolicyTools) {
  const { apply, descriptor, method, accessor, propertyOwner, deny, fail, str, array } =
    tools;
  const prevent = Event.prototype.preventDefault;
  const nativeAdd = EventTarget.prototype.addEventListener;
  const nav = window.navigation;
  if (!nav || typeof NavigateEvent !== 'function')
    throw new Error('Navigation API required');
  const nativeHash = descriptor(NavigateEvent.prototype, 'hashChange')!.get!;
  apply(nativeAdd, nav, [
    'navigate',
    (event) => {
      if (!apply(nativeHash, event, [])) apply(prevent, event, []);
    },
    { capture: true },
  ]);
  const modifier = ['ctrlKey', 'metaKey', 'shiftKey', 'altKey'].map(
    (k) => descriptor(MouseEvent.prototype, k)!.get!,
  );
  apply(nativeAdd, window, [
    'click',
    (e) => {
      if (modifier.some((get) => apply(get, e, []))) apply(prevent, e, []);
    },
    { capture: true },
  ]);
  for (const name of ['auxclick', 'contextmenu'])
    apply(nativeAdd, window, [name, (e) => apply(prevent, e, []), { capture: true }]);
  // The browser's own rich-HTML insertion must not bypass parser admission.
  for (const name of ['paste', 'drop'])
    apply(nativeAdd, window, [
      name,
      (event: Event & { clipboardData?: DataTransfer; dataTransfer?: DataTransfer }) => {
        const transfer = event.clipboardData || event.dataTransfer;
        if (transfer && array(transfer.types || []).includes('text/html'))
          apply(prevent, event, []);
      },
      { capture: true },
    ]);
  method(window, 'open', deny);
  method(window, 'print', deny);
  if (globalThis.DocumentPictureInPicture)
    method(DocumentPictureInPicture.prototype, 'requestWindow', deny);
  const pipOwner = propertyOwner(window, 'documentPictureInPicture');
  if (pipOwner) accessor(pipOwner, 'documentPictureInPicture', { get: deny });
  method(Document.prototype, 'execCommand', deny);
  for (const key of ['cookie', 'domain']) {
    const owner = propertyOwner(document, key);
    if (owner) accessor(owner, key, { get: deny, set: deny });
  }
  const cookieOwner = propertyOwner(window, 'cookieStore');
  if (cookieOwner) accessor(cookieOwner, 'cookieStore', { get: deny });
  for (const key of ['open', 'write', 'writeln']) method(Document.prototype, key, deny);
  for (const key of ['back', 'forward', 'go']) method(History.prototype, key, deny);
  const NativeURL = URL,
    initialURL = new NativeURL(location.href);
  for (const key of ['pushState', 'replaceState'] as const) {
    const fn = History.prototype[key];
    method(
      History.prototype,
      key,
      function (this: History, state: unknown, title: unknown, url?: unknown) {
        const targetURL = url === undefined || url === null ? url : str(url);
        if (targetURL !== undefined && targetURL !== null) {
          const target = new NativeURL(targetURL, location.href);
          if (
            target.origin !== initialURL.origin ||
            target.pathname !== initialURL.pathname ||
            target.search !== initialURL.search
          )
            fail('Only fragment history is admitted');
        }
        return apply(fn, this, [state, str(title), targetURL]);
      },
    );
  }

  for (const key of ['back', 'forward', 'traverseTo'])
    method(Navigation.prototype, key, deny);
}
