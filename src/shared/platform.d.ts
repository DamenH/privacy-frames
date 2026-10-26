// Browser extensions deliberately feature-detected by the confinement boundary.
declare const __BUILD_ID__: string;
interface DocumentPictureInPicture {
  requestWindow: (...args: unknown[]) => unknown;
}
declare var DocumentPictureInPicture: { prototype: DocumentPictureInPicture };
declare var Worklet: { prototype: object };
declare var MediaSession: { prototype: object };
declare var Navigation: { prototype: object };
declare var NavigateEvent: { prototype: object };
declare var SpeechRecognition: { prototype: object };
declare var webkitSpeechRecognition: { prototype: object };
declare var NavigationPreloadManager: { prototype: object };
interface Window {
  readonly privacyHost?: {
    readonly version: number;
    readonly application: string;
    readonly publisher: string;
    readonly mode: 'network-isolated';
  };
  boundaryProbes: Record<string, () => unknown>;
}
