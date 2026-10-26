import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ApplicationList } from './components/application-list';
import { useLibrary } from './hooks/use-library';

export function App() {
  const library = useLibrary();
  const [url, setURL] = useState('');
  const urlInput = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await library.install(url)) setURL('');
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-7 sm:px-6 sm:py-12">
      <header className="mb-8 flex items-center justify-between gap-4 sm:mb-10">
        <h1 className="text-xl font-semibold tracking-tight">Privacy Frames</h1>
        <nav className="header-links flex gap-4 text-xs text-slate-400">
          <a href="./report.html">Report</a>
          <a
            href="https://github.com/DamenH/privacy-frames"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
        </nav>
      </header>

      <form id="install" onSubmit={(event) => void submit(event)}>
        <label htmlFor="app-url" className="mb-2 block text-sm">
          Application URL
        </label>
        <div className="input-row flex gap-2 sm:gap-3">
          <input
            ref={urlInput}
            id="app-url"
            type="url"
            placeholder="https://…"
            required
            autoComplete="off"
            spellCheck={false}
            value={url}
            onChange={(event) => setURL(event.target.value)}
            className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
          />
          <button type="submit" disabled={!library.ready || library.installing}>
            {library.installing ? 'Installing…' : 'Install'}
          </button>
        </div>
      </form>

      <p
        id="status"
        role="status"
        aria-live="polite"
        data-error={library.status.error}
        className="mt-3 mb-6 min-h-5 text-xs leading-relaxed wrap-anywhere text-slate-400 data-[error=true]:text-red-300"
      >
        {library.status.message}
      </p>

      <section className="examples-section mb-8" aria-labelledby="examples-title">
        <h2 id="examples-title" className="section-label mb-3">
          Examples
        </h2>
        <div id="examples" className="flex flex-wrap gap-2">
          {library.config?.examples.map((example) => (
            <button
              key={example.url}
              className="example"
              type="button"
              title={example.url}
              onClick={() => {
                setURL(example.url);
                urlInput.current?.focus();
              }}
            >
              {example.name}
            </button>
          ))}
        </div>
      </section>

      <section
        className="library border-t border-slate-800 pt-6"
        aria-labelledby="library-title"
      >
        <div className="library-heading mb-3 flex items-center justify-between">
          <h2 id="library-title" className="section-label">
            Installed{' '}
            <span
              id="count"
              className="ml-1 rounded bg-slate-800 px-1.5 py-0.5 text-xs tracking-normal"
            >
              {library.apps.length}
            </span>
          </h2>
          <button
            id="refresh-apps"
            type="button"
            className="quiet px-3 py-1.5 text-xs"
            disabled={!library.ready}
            onClick={() => void library.refresh()}
          >
            Refresh
          </button>
        </div>
        <ApplicationList
          apps={library.apps}
          runtimeURL={library.config?.runtimeURL}
          onRemove={library.remove}
        />
      </section>

      <details className="observations mt-8 text-xs text-slate-400">
        <summary className="w-fit cursor-pointer">Diagnostics</summary>
        <button
          id="refresh-events"
          type="button"
          className="quiet mt-4 px-3 py-2 text-xs"
          disabled={!library.ready}
          onClick={() => void library.refreshObservations()}
        >
          Refresh
        </button>
        <pre
          id="events"
          className="mt-3 max-h-72 overflow-auto rounded-md border border-slate-800 bg-slate-900 p-3 text-[10px] leading-relaxed"
        >
          {library.observations}
        </pre>
      </details>
    </main>
  );
}
