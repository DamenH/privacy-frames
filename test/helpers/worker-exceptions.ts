import type { Browser } from 'playwright';
import type { PreparationWorkerDiagnostic } from './installation-errors.ts';

type WorkerException = Pick<
  PreparationWorkerDiagnostic,
  'workerURL' | 'message' | 'type' | 'location'
> & { evidence: unknown };

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Observe native worker exception frames without changing page or worker globals. */
export async function observeWorkerExceptions(
  browser: Browser,
  workerURL: string,
  report: (exception: WorkerException) => void,
): Promise<() => Promise<void>> {
  const channel = await browser.newBrowserCDPSession();
  const targets = new Map<string, unknown>();
  const origins = new Map<string, Map<number, string>>();
  let sequence = 0;
  let closed = false;
  channel.on('Target.targetCreated', async ({ targetInfo }) => {
    if (closed || targetInfo.type !== 'worker') return;
    try {
      const { sessionId } = await channel.send('Target.attachToTarget', {
        targetId: targetInfo.targetId,
        flatten: false,
      });
      targets.set(sessionId, targetInfo);
      await channel.send('Target.sendMessageToTarget', {
        sessionId,
        message: JSON.stringify({ id: ++sequence, method: 'Runtime.enable' }),
      });
    } catch {
      // Short-lived workers can close before attachment; unmatched errors fail.
    }
  });
  channel.on('Target.receivedMessageFromTarget', ({ sessionId, message }) => {
    const data = record(JSON.parse(message));
    const params = record(data?.params);
    if (data?.method === 'Runtime.executionContextCreated') {
      const context = record(params?.context);
      if (typeof context?.id === 'number' && typeof context.origin === 'string') {
        const entries = origins.get(sessionId) || new Map<number, string>();
        entries.set(context.id, context.origin);
        origins.set(sessionId, entries);
      }
      return;
    }
    if (data?.method !== 'Runtime.exceptionThrown') return;
    const details = record(params?.exceptionDetails);
    const trace = record(details?.stackTrace);
    const frames = Array.isArray(trace?.callFrames) ? trace.callFrames : [];
    const source = frames.map(record).find((frame) => frame?.url === workerURL);
    const exception = record(details?.exception);
    if (!source || typeof exception?.description !== 'string') return;
    report({
      workerURL,
      message: exception.description,
      type: 'error',
      location: {
        url: workerURL,
        lineNumber: typeof source.lineNumber === 'number' ? source.lineNumber : 0,
        columnNumber: typeof source.columnNumber === 'number' ? source.columnNumber : 0,
      },
      evidence: {
        target: targets.get(sessionId),
        contextOrigin:
          typeof details?.executionContextId === 'number'
            ? origins.get(sessionId)?.get(details.executionContextId)
            : undefined,
        exceptionDetails: details,
      },
    });
  });
  await channel.send('Target.setDiscoverTargets', { discover: true });
  return async () => {
    closed = true;
    await channel.detach();
  };
}
