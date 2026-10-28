export const CONNECTION_DATABASE = 'privacy-frames-shared-connections-v1';
export interface SharedConnectionProbe {
  checks: number;
  conflictingWinners: number[];
  privateNamespaced: boolean;
}
declare global {
  interface Window {
    runSharedConnectionProbe(): Promise<SharedConnectionProbe>;
    runScopedSharedProbe(): Promise<{ empty: boolean }>;
  }
}
