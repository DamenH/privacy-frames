import { useEffect, useRef, useState } from 'react';
import type { useLibrary } from '../hooks/use-library';
import type { useShareRequest } from '../hooks/use-share-request';
import { matchingInstallation } from '../share-link';
import { applicationLaunchURL } from '../../shared/runtime-url';
import { errorMessage } from '../types';

type Props = ReturnType<typeof useShareRequest> & {
  library: ReturnType<typeof useLibrary>;
};

export function SharedInstallation({ state, dismiss, library }: Props) {
  const started = useRef<string | null>(null);
  const mounted = useRef(false);
  const [operation, setOperation] = useState<{
    hash: string;
    phase: 'installing' | 'opening' | 'failed';
    error?: string;
  } | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (
      state.kind !== 'ready' ||
      !library.ready ||
      !library.config ||
      library.installing ||
      started.current === state.hash
    )
      return;

    const { request, hash } = state;
    const runtimeURL = library.config.runtimeURL;
    started.current = hash;
    const current = () => mounted.current && location.hash === hash;
    async function open() {
      try {
        let app = matchingInstallation(request, library.apps);
        if (!app) {
          setOperation({ hash, phase: 'installing' });
          app = (await library.install(request)) ?? undefined;
        }
        if (!current()) return;
        if (!app) {
          setOperation({ hash, phase: 'failed', error: 'Could not install this app.' });
          return;
        }
        setOperation({ hash, phase: 'opening' });
        // Replace the share screen so Back does not immediately reopen the app.
        location.replace(applicationLaunchURL(app, runtimeURL).href);
      } catch (error) {
        if (current())
          setOperation({ hash, phase: 'failed', error: errorMessage(error) });
      }
    }
    void open();
  }, [state, library]);

  const request = state.kind === 'ready' ? state.request : null;
  const active =
    state.kind === 'ready' && operation?.hash === state.hash ? operation : null;
  const failure =
    state.kind === 'error'
      ? 'Could not read this share link. ' + state.message
      : library.status.error && (!library.ready || active?.phase === 'failed')
        ? library.status.message
        : active?.error;
  const installing = active?.phase === 'installing';
  const progress = installing
    ? library.status.message === 'Ready to install.'
      ? 'Preparing installation…'
      : library.status.message
    : state.kind === 'loading'
      ? 'Reading share link…'
      : 'Checking your local library…';

  return (
    <section
      aria-label="Opening shared app"
      className="flex items-start gap-3 py-10 sm:py-16"
    >
      {!failure && (
        <span
          aria-hidden="true"
          className="mt-1 size-4 shrink-0 animate-spin rounded-full border-2 border-slate-700 border-t-slate-300 motion-reduce:animate-none"
        />
      )}
      <div className="min-w-0">
        {failure ? (
          <>
            <p
              role="alert"
              className="text-sm leading-relaxed wrap-anywhere text-red-300"
            >
              {failure}
            </p>
            <a
              href="./"
              className="mt-4 inline-block text-xs text-slate-400"
              onClick={(event) => {
                event.preventDefault();
                dismiss();
              }}
            >
              Back to library
            </a>
          </>
        ) : (
          <div role="status" aria-live="polite">
            <p className="text-sm leading-relaxed wrap-anywhere text-slate-200">
              {installing ? 'Installing' : 'Opening'}
              {request ? ' ' + request.url : ' app…'}
            </p>
            <p className="mt-2 text-xs leading-relaxed wrap-anywhere text-slate-400">
              {progress}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
