/** Test-only gate. No publisher code or usable Window has been released here. */
const nativeAdd = EventTarget.prototype.addEventListener;
const nativeRemove = EventTarget.prototype.removeEventListener;
const nativeStop = Event.prototype.stopImmediatePropagation;
const nativeSet = Element.prototype.setAttribute;
const nativeRemoveAttribute = Element.prototype.removeAttribute;
const nativeTimeout = setTimeout;
const nativeClearTimeout = clearTimeout;
const NativePromise = Promise;
const NativeError = Error;
const nativeNow = Date.now;
const apply = Reflect.apply;
const nativeWindow = window;
const nativeDocument = document;
const eventType = '__pf_local_guard_release__';
const marker = 'data-pf-test-local-guard';

/** Called after native shell load and local preparation, before guarded notice. */
export function pauseBeforePublication(context: string): Promise<void> {
  const element = nativeDocument.documentElement;
  return new NativePromise<void>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      apply(nativeRemove, nativeWindow, [eventType, released, true]);
      apply(nativeRemoveAttribute, element, [marker]);
      apply(nativeClearTimeout, nativeWindow, [timer]);
    };
    const released = (event: Event) => {
      // There is no application-controlled payload or callback. A holder of a
      // Window reference could only release an already-prepared realm. The
      // original private parent handshake still controls publication afterward.
      apply(nativeStop, event, []);
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    apply(nativeAdd, nativeWindow, [eventType, released, true]);
    timer = apply(nativeTimeout, nativeWindow, [
      () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new NativeError('Test-only local guard pause timed out'));
      },
      8000,
    ]);
    // A DOM marker carries observation data, never a callable or release token.
    apply(nativeSet, element, [marker, context + ':' + nativeNow()]);
  });
}
