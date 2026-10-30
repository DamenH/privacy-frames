// This module must stay independent of the rest of the runtime's module graph.
let installed = false;

/** Establish document-exit cancellation before initializing the runtime. */
export function installDocumentExitGuard() {
  if (installed) return;
  const apply = Reflect.apply;
  const descriptor = Object.getOwnPropertyDescriptor;
  const prevent = Event.prototype.preventDefault;
  const nativeAdd = EventTarget.prototype.addEventListener;
  const nav = window.navigation;
  if (!nav || typeof NavigateEvent !== 'function')
    throw new Error('Navigation API required');
  const nativeDestination = descriptor(NavigateEvent.prototype, 'destination')!.get!;
  const nativeSameDocument = descriptor(
    NavigationDestination.prototype,
    'sameDocument',
  )!.get!;
  apply(nativeAdd, nav, [
    'navigate',
    (event: NavigateEvent) => {
      const destination = apply(nativeDestination, event, []);
      if (!apply(nativeSameDocument, destination, [])) apply(prevent, event, []);
    },
    { capture: true },
  ]);
  installed = true;
}
