import { internalRecord } from '../../shared/primordials.ts';
import type { PolicyTools } from './native.ts';

export interface ContextFactories {
  Worker?: Function;
  SharedWorker?: Function;
  WorkletAddModule?: Function;
}

/** Close effects that do not reliably pass through the HTTP request gate. */
export function installEffectPolicy(
  tools: PolicyTools,
  getApplicationWorker: () => unknown,
  contextFactories: ContextFactories = internalRecord({}),
  target: object = globalThis,
) {
  const { apply, descriptor, method, accessor, propertyOwner, deny, array } = tools;
  const nativeNavigator = typeof navigator === 'object' ? navigator : null;
  // Remove alternate agents/transports, including prototype recovery routes.
  for (const key of [
    'WebSocket',
    'WebTransport',
    'RTCPeerConnection',
    'webkitRTCPeerConnection',
    'RTCDataChannel',
    'Worker',
    'SharedWorker',
    'ShadowRealm',
    'XSLTProcessor',
    'BroadcastChannel',
    'EventSource',
    'Notification',
    'PresentationRequest',
    'fetchLater',
    'PendingGetBeacon',
    'PendingPostBeacon',
    'TCPSocket',
    'UDPSocket',
    'WebSocketStream',
    'NDEFReader',
  ])
    if (key in target) {
      const owner = propertyOwner(target, key);
      const replacement =
        key === 'Worker'
          ? contextFactories.Worker || deny
          : key === 'SharedWorker'
            ? contextFactories.SharedWorker || deny
            : deny;
      if (owner) method(owner, key, replacement);
    }
  for (const key of Object.getOwnPropertyNames(target).filter((k) =>
    /^(RTC|webkitRTC)/.test(k),
  )) {
    const owner = propertyOwner(target, key);
    if (owner) method(owner, key, deny);
  }
  if (globalThis.Worklet)
    method(Worklet.prototype, 'addModule', contextFactories.WorkletAddModule || deny);
  // Browser-mediated services are not necessarily ordinary document fetches.
  // Keep local Web Audio, but exclude remote speech/casting and URL-bearing OS
  // media artwork. Text-only media metadata used by players remains available.
  if (globalThis.SpeechSynthesis) method(SpeechSynthesis.prototype, 'speak', deny);
  for (const ctor of [globalThis.SpeechRecognition, globalThis.webkitSpeechRecognition])
    if (ctor) method(ctor.prototype, 'start', deny);
  if (globalThis.RemotePlayback)
    for (const key of ['prompt', 'watchAvailability', 'cancelWatchAvailability'])
      method(RemotePlayback.prototype, key, deny);
  if (globalThis.MediaMetadata && globalThis.MediaSession) {
    const artwork = descriptor(MediaMetadata.prototype, 'artwork'),
      chapters = descriptor(MediaMetadata.prototype, 'chapterInfo'),
      metadata = descriptor(MediaSession.prototype, 'metadata');
    if (artwork?.set)
      accessor(
        MediaMetadata.prototype,
        'artwork',
        internalRecord({
          set(value) {
            if (array(value).length) deny();
            return apply(artwork.set!, this, [[]]);
          },
        }),
      );
    if (metadata?.set)
      accessor(
        MediaSession.prototype,
        'metadata',
        internalRecord({
          set(value) {
            if (
              value !== null &&
              ((artwork?.get && apply(artwork.get, value, []).length) ||
                (chapters?.get && apply(chapters.get, value, []).length))
            )
              deny();
            return apply(metadata.set!, this, [value]);
          },
        }),
      );
  }
  for (const ctor of [
    globalThis.ServiceWorkerContainer,
    globalThis.ServiceWorkerRegistration,
    globalThis.ServiceWorker,
    globalThis.NavigationPreloadManager,
  ])
    if (ctor)
      for (const key of [
        'register',
        'getRegistration',
        'getRegistrations',
        'startMessages',
        'update',
        'unregister',
        'postMessage',
        'enable',
        'disable',
        'setHeaderValue',
        'getState',
      ])
        method(ctor.prototype, key, deny);
  if (nativeNavigator) {
    const owner = propertyOwner(nativeNavigator, 'serviceWorker');
    if (owner)
      accessor(
        owner,
        'serviceWorker',
        internalRecord({ get: () => getApplicationWorker() || deny() }),
      );
    for (const key of [
      'sendBeacon',
      'share',
      'registerProtocolHandler',
      'unregisterProtocolHandler',
      'runAdAuction',
      'joinAdInterestGroup',
      'leaveAdInterestGroup',
      'updateAdInterestGroups',
      'getInterestGroupAdAuctionData',
      'createAuctionNonce',
      'deprecatedReplaceInURN',
      'deprecatedURNToURL',
    ]) {
      const owner = propertyOwner(nativeNavigator, key);
      if (owner) method(owner, key, deny);
    }
    // StorageManager exposes origin-wide OPFS; Web Locks expose shared names.
    for (const key of ['presentation', 'storage', 'locks']) {
      const owner = propertyOwner(nativeNavigator, key);
      if (owner) accessor(owner, key, internalRecord({ get: deny }));
    }
  }
  if (globalThis.CredentialsContainer)
    for (const key of ['get', 'create', 'store', 'preventSilentAccess'])
      method(CredentialsContainer.prototype, key, deny);
  // FedCM can make browser-originated requests that skip the service worker.
  // These static methods are separate from CredentialsContainer methods.
  for (const [name, keys] of [
    ['IdentityCredential', ['disconnect']],
    ['IdentityProvider', ['getUserInfo']],
  ] as const) {
    const owner = propertyOwner(target, name);
    const constructor = owner && descriptor(owner, name)?.value;
    if (typeof constructor === 'function')
      for (const key of keys) method(constructor, key, deny);
  }
  if (globalThis.Clipboard)
    for (const key of ['write', 'writeText']) method(Clipboard.prototype, key, deny);
  for (const key of ['sharedStorage']) {
    const owner = propertyOwner(target, key);
    if (owner) accessor(owner, key, internalRecord({ get: deny }));
  }
}
