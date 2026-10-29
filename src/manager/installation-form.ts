import type { HostConfig, InstallationRequest } from '../shared/types.ts';
import { installationInput } from '../installation/session.ts';

export type ResourceListSelection =
  { kind: 'none' } | { kind: 'url'; value: string } | { kind: 'text'; value: string };

/** Catalog defaults also apply when the same URL is typed or pasted. */
export function catalogResourceList(
  url: string,
  examples: HostConfig['examples'],
): ResourceListSelection {
  const example = examples.find((entry) => entry.url === url.trim());
  return example?.resourceListURL
    ? { kind: 'url', value: example.resourceListURL }
    : { kind: 'none' };
}

export function formInstallationRequest(
  url: string,
  list: ResourceListSelection,
): InstallationRequest {
  return installationInput({
    url: url.trim(),
    ...(list.kind === 'none'
      ? {}
      : {
          resourceList:
            list.kind === 'url'
              ? { kind: 'url', url: list.value.trim() }
              : { kind: 'text', text: list.value },
        }),
  });
}
