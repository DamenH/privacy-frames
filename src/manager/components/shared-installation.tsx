import type { useLibrary } from '../hooks/use-library';
import type { useShareRequest } from '../hooks/use-share-request';
import { matchingInstallation } from '../share-link';
import { applicationLaunchURL } from '../../shared/runtime-url';

type Props = ReturnType<typeof useShareRequest> & {
  library: ReturnType<typeof useLibrary>;
};

export function SharedInstallation({ state, dismiss, library }: Props) {
  const request = state.kind === 'ready' ? state.request : null;
  const installed = request ? matchingInstallation(request, library.apps) : undefined;
  const source = request ? new URL(request.url) : null;

  async function installAndOpen() {
    if (state.kind !== 'ready' || !library.config || library.installing) return;
    const app = await library.install(state.request);
    if (app && location.hash === state.hash)
      location.assign(applicationLaunchURL(app, library.config.runtimeURL).href);
  }

  return (
    <section
      aria-labelledby="shared-title"
      className="rounded-lg border border-slate-800 p-5 sm:p-7"
    >
      <h2 id="shared-title" className="mb-3 text-lg font-medium">
        {installed ? installed.manifest.name : 'Open a shared app'}
      </h2>
      {state.kind === 'loading' && <p role="status">Reading share link…</p>}
      {state.kind === 'error' && (
        <p role="alert" className="text-sm text-red-300">
          Could not read this share link. {state.message}
        </p>
      )}
      {request && source && (
        <>
          <p className="text-sm wrap-anywhere text-slate-300">{source.href}</p>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            {installed
              ? 'This app is already in your library.'
              : 'Install a local copy in Privacy Frames, then open it.'}
          </p>
          {request.resourceList && (
            <details className="mt-4 text-xs text-slate-400">
              <summary className="w-fit cursor-pointer">
                {request.resourceList.kind === 'url'
                  ? 'Includes a resource list'
                  : `Includes ${request.resourceList.text.split('\n').length} additional resource ${request.resourceList.text.includes('\n') ? 'URLs' : 'URL'}`}
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded bg-slate-900 p-3 whitespace-pre-wrap wrap-anywhere">
                {request.resourceList.kind === 'url'
                  ? request.resourceList.url
                  : request.resourceList.text}
              </pre>
            </details>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {installed && library.config ? (
              <>
                <a
                  className="button"
                  href={applicationLaunchURL(installed, library.config.runtimeURL).href}
                >
                  Open
                </a>
                <button
                  type="button"
                  className="quiet text-xs"
                  disabled={!library.ready || library.installing}
                  onClick={() => void installAndOpen()}
                >
                  {library.installing ? 'Installing…' : 'Reinstall & open'}
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={!library.ready || library.installing}
                onClick={() => void installAndOpen()}
              >
                {library.installing ? 'Installing…' : 'Install & open'}
              </button>
            )}
          </div>
        </>
      )}
      <p
        role="status"
        aria-live="polite"
        data-error={library.status.error}
        className="mt-4 text-xs leading-relaxed wrap-anywhere text-slate-400 data-[error=true]:text-red-300"
      >
        {library.status.message}
      </p>
      <button
        type="button"
        className="quiet mt-5 px-0 text-xs"
        disabled={library.installing}
        onClick={dismiss}
      >
        Back to library
      </button>
    </section>
  );
}
