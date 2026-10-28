export const INTENT_DATABASE = 'privacy-frames-document-intents-v2';

export interface IntentProbe {
  checks: number;
  bindWinners: number;
  consumeWinners: number;
  privateNamespaced: boolean;
  recordPurged: boolean;
}
export interface ScopedIntentProbe {
  empty: boolean;
}

declare global {
  interface Window {
    runIntentProbe(): Promise<IntentProbe>;
    runScopedIntentProbe(): Promise<ScopedIntentProbe>;
  }
}
