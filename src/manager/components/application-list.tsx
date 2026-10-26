import { applicationURL } from '../../shared/runtime-url';
import type { AppSummary } from '../types';

interface ApplicationListProps {
  apps: AppSummary[];
  runtimeURL?: string;
  onRemove: (id: string) => Promise<void>;
}

export function ApplicationList({ apps, runtimeURL, onRemove }: ApplicationListProps) {
  return (
    <>
      <p id="empty" hidden={apps.length > 0} className="my-7 text-sm text-slate-500">
        No applications installed.
      </p>
      <div id="app-list">
        {runtimeURL &&
          apps.map((app) => (
            <article
              key={app.id}
              className="app-card flex items-center justify-between gap-3 border-b border-slate-800 py-4 sm:gap-5"
            >
              <div className="app-info min-w-0">
                <h3 className="mb-1 text-sm font-medium text-slate-200">
                  {app.manifest.name}
                </h3>
                <p className="source text-xs wrap-anywhere text-slate-400">
                  {new URL(app.source).hostname}
                </p>
              </div>
              <div className="actions flex shrink-0 gap-2">
                <a
                  className="button px-3 py-2 text-xs"
                  href={applicationURL(app, new URL(runtimeURL)).href}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-app={app.manifest.id}
                  data-installation={app.id}
                >
                  Open
                </a>
                <button
                  className="quiet px-3 py-2 text-xs"
                  type="button"
                  onClick={() => void onRemove(app.id)}
                >
                  Remove
                </button>
              </div>
            </article>
          ))}
      </div>
    </>
  );
}
