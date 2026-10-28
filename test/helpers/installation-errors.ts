export interface InstallationError {
  role: 'manager' | 'application';
  phase: string;
  installationURL?: string;
  message: string;
  name: string;
  stack: string;
  pageURL: string;
  workerURLs: string[];
}

export interface InstallationOutcome {
  url: string;
  status: string;
  outcome: { status: string; reason?: string };
}

export interface PreparationWorkerDiagnostic {
  phase: string;
  installationURL?: string;
  workerURL: string;
  message: string;
  type: string;
  location: { url: string; lineNumber: number; columnNumber: number };
  evidence?: unknown;
}

export type PreparationErrorCategory = 'primary-failure' | 'unsupported-secondary';

/** Match optional failures to their installer worker and admitted installation. */
export function expectedPreparationError(
  error: InstallationError,
  installations: readonly InstallationOutcome[],
  installerWorkerURL: string,
  diagnostics: readonly PreparationWorkerDiagnostic[] = [],
): boolean {
  return (
    preparationErrorCategory(error, installations, installerWorkerURL, diagnostics) !==
    undefined
  );
}

export function preparationErrorCategory(
  error: InstallationError,
  installations: readonly InstallationOutcome[],
  installerWorkerURL: string,
  diagnostics: readonly PreparationWorkerDiagnostic[] = [],
): PreparationErrorCategory | undefined {
  if (
    error.role !== 'manager' ||
    error.phase !== 'installation' ||
    !error.installationURL ||
    !error.message ||
    !error.workerURLs.includes(installerWorkerURL)
  )
    return;
  const workerDiagnostic = diagnostics.some(
    (diagnostic) =>
      diagnostic.phase === 'installation' &&
      diagnostic.installationURL === error.installationURL &&
      diagnostic.workerURL === installerWorkerURL &&
      diagnostic.type === 'error' &&
      diagnostic.message.includes(error.message),
  );
  if (!workerDiagnostic && !error.stack.includes(installerWorkerURL)) return;
  const installation = installations.find((item) => item.url === error.installationURL);
  if (
    !installation ||
    !installation.status.startsWith('Installed ') ||
    !['failed', 'unsupported'].includes(installation.outcome.status) ||
    typeof installation.outcome.reason !== 'string'
  )
    return;
  if (installation.outcome.reason.includes(error.message)) return 'primary-failure';
  // An asynchronous publisher bootstrap can reject after the profile has
  // already declined its missing lifecycle handlers. Keep both diagnostics.
  if (installation.outcome.status === 'unsupported' && workerDiagnostic)
    return 'unsupported-secondary';
}
