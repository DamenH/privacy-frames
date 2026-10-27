/** Publicly downloaded resources become immutable installation inputs. */
export interface Resource {
  path: string;
  url: string;
  contentType: string;
  sha256: string;
}
export interface DownloadedResource extends Resource {
  bytes: ArrayBuffer;
}
export interface InstallationMetadata {
  id: string;
  name: string;
  entry: string;
}
export interface PrecacheReceipt {
  scriptURL: string;
  scope: string;
  completed: ['install', 'activate'];
  profile: 'precache-v1';
}
export type PreparationOutcome =
  | { status: 'absent' }
  | { status: 'completed'; scriptURL: string }
  | { status: 'unsupported' | 'failed'; scriptURL: string; reason: string };
export interface Preparation {
  profile: 'website-v1';
  outcome: PreparationOutcome;
  serviceWorker: PrecacheReceipt | null;
  caches: { name: string; urls: string[] }[];
  ended: true;
}
export interface Installation {
  id: string;
  documentBase?: string;
  manifest: InstallationMetadata;
  source: string;
  resources: Resource[];
  publisherManifest?: { url: string; value: Record<string, unknown> } | null;
  size: number;
  installedAt: string;
  preparation: Preparation;
}
export interface PreparedInstallation extends Omit<Installation, 'resources'> {
  resources: DownloadedResource[];
}
export interface HostConfig {
  managerURL: string;
  runtimeURL: string;
  managerOrigins: string[];
  examples: { name: string; url: string }[];
}
export type ManagementOperation = 'install' | 'list' | 'remove' | 'events';
export interface RuntimeEvent {
  kind: string;
  url: string;
  method: string;
  time: string;
}
