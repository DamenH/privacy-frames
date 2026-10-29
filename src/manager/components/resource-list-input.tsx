import { useId } from 'react';
import { RESOURCE_LIST_BYTES } from '../../installation/resource-list';
import type { ResourceListSelection } from '../installation-form';

export interface ResourceListUploadState {
  reading: boolean;
  error?: string;
}

interface Props {
  value: ResourceListSelection;
  onChange(value: ResourceListSelection): void;
  disabled: boolean;
  automatic: boolean;
  onUploadStateChange(state: ResourceListUploadState): void;
}

const fieldClass =
  'mt-2 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400';

export function ResourceListInput({
  value,
  onChange,
  disabled,
  automatic,
  onUploadStateChange,
}: Props) {
  const id = useId();

  async function upload(file: File | undefined) {
    if (!file) return;
    onUploadStateChange({ reading: true });
    if (file.size > RESOURCE_LIST_BYTES) {
      onUploadStateChange({ reading: false, error: 'Resource list exceeds 256 KiB.' });
      return;
    }
    try {
      const text = await file.text();
      onChange({ kind: 'text', value: text });
      onUploadStateChange({ reading: false });
    } catch {
      onUploadStateChange({ reading: false, error: 'Could not read that file.' });
    }
  }

  return (
    <details
      id="resource-list-options"
      open={value.kind !== 'none'}
      className="mt-4 text-sm text-slate-400"
    >
      <summary className="w-fit cursor-pointer">
        Additional resources (optional){value.kind !== 'none' ? ' · List selected' : ''}
      </summary>
      <div className="mt-3 rounded-md border border-slate-800 p-3">
        <label htmlFor={id}>Resource list</label>
        <select
          id={id}
          disabled={disabled}
          value={value.kind}
          onChange={(event) => {
            onUploadStateChange({ reading: false });
            const kind = event.target.value;
            onChange(
              kind === 'url'
                ? { kind: 'url', value: '' }
                : kind === 'text'
                  ? { kind: 'text', value: '' }
                  : { kind: 'none' },
            );
          }}
          className={fieldClass}
        >
          <option value="none">No resource list</option>
          <option value="url">List URL</option>
          <option value="text">Paste or upload a list</option>
        </select>
        {value.kind === 'url' && (
          <label className="mt-3 block">
            List URL
            <input
              id="resource-list-url"
              type="url"
              required
              value={value.value}
              onChange={(event) => onChange({ kind: 'url', value: event.target.value })}
              placeholder="https://…/resources.uri-list"
              disabled={disabled}
              spellCheck={false}
              className={fieldClass}
            />
          </label>
        )}
        {value.kind === 'text' && (
          <>
            <label className="mt-3 block">
              Resource URLs, one per line
              <textarea
                id="resource-list-text"
                value={value.value}
                onChange={(event) =>
                  onChange({ kind: 'text', value: event.target.value })
                }
                disabled={disabled}
                spellCheck={false}
                rows={5}
                className={fieldClass + ' font-mono text-xs'}
              />
            </label>
            <label className="mt-3 block">
              Upload a list (up to 256 KiB)
              <input
                id="resource-list-file"
                type="file"
                accept=".uris,.uri,.uri-list,.txt,text/uri-list,text/plain"
                disabled={disabled}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  void upload(file);
                }}
                className="mt-2 block w-full text-xs"
              />
            </label>
          </>
        )}
        {automatic && value.kind !== 'none' && (
          <p id="resource-list-default" className="mt-2 text-xs text-slate-400">
            Selected from Examples. Change the list or choose No resource list.
          </p>
        )}
        {value.kind !== 'none' && (
          <p className="mt-2 text-xs text-slate-400">
            Absolute HTTPS URLs, one per line. Lines starting with # are comments.
          </p>
        )}
      </div>
    </details>
  );
}
