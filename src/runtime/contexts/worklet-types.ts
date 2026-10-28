export const WORKLET_POLICY_VERSION = 1;
export type WorkletKind = 'audio' | 'paint';
export interface WorkletIdentity {
  version: number;
  id: string;
  application: string;
  generation: string;
  parentClient: string;
  kind: WorkletKind;
}
export type WorkletModuleSource =
  | { kind: 'resource'; url: string }
  | { kind: 'blob'; url: string; text: string; contentType: string };
export interface WorkletRegistration {
  id: string;
  kind: WorkletKind;
  url: string;
}
