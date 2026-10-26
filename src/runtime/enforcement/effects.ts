import type { PolicyTools } from './native.ts';

/** Close effects that do not reliably pass through the HTTP request gate. */
export function installEffectPolicy(
  tools: PolicyTools,
  getApplicationWorker: () => unknown,
) {
  const { apply, descriptor, method, accessor, propertyOwner, deny, array } = tools;
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
    if (key in window) method(window, key, deny);
  for (const key of Object.getOwnPropertyNames(window).filter((k) =>
    /^(RTC|webkitRTC)/.test(k),
  ))
    method(window, key, deny);
  if (globalThis.Worklet) method(Worklet.prototype, 'addModule', deny);
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
      accessor(MediaMetadata.prototype, 'artwork', {
        set(value) {
          if (array(value).length) deny();
          return apply(artwork.set!, this, [[]]);
        },
      });
    if (metadata?.set)
      accessor(MediaSession.prototype, 'metadata', {
        set(value) {
          if (
            value !== null &&
            ((artwork?.get && apply(artwork.get, value, []).length) ||
              (chapters?.get && apply(chapters.get, value, []).length))
          )
            deny();
          return apply(metadata.set!, this, [value]);
        },
      });
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
  if (globalThis.Navigator) {
    const owner = propertyOwner(navigator, 'serviceWorker');
    if (owner)
      accessor(owner, 'serviceWorker', { get: () => getApplicationWorker() || deny() });
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
    ])
      method(Navigator.prototype, key, deny);
  }
  if (globalThis.CredentialsContainer)
    for (const key of ['get', 'create', 'store', 'preventSilentAccess'])
      method(CredentialsContainer.prototype, key, deny);
  if (globalThis.Navigator)
    for (const key of ['presentation', 'storage']) {
      const owner = propertyOwner(navigator, key);
      if (owner) accessor(owner, key, { get: deny });
    }
  if (globalThis.Clipboard)
    for (const key of ['write', 'writeText']) method(Clipboard.prototype, key, deny);
  for (const key of ['sharedStorage']) {
    const owner = propertyOwner(window, key);
    if (owner) accessor(owner, key, { get: deny });
  }
}
