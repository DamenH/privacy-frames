import type {
  HostConfig as Configuration,
  Installation,
  RuntimeEvent,
} from '../shared/types.ts';

export type AppSummary = Pick<
  Installation,
  'id' | 'manifest' | 'source' | 'installedAt' | 'size'
>;
export type HostConfig = Pick<Configuration, 'managerURL' | 'runtimeURL' | 'examples'>;
export type RuntimeObservation = RuntimeEvent;

export interface Status {
  message: string;
  error: boolean;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
