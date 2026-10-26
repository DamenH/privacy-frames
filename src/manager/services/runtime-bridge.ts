type Operation = 'install' | 'list' | 'remove' | 'events';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface RuntimeReply {
  id: number;
  ok: boolean;
  value?: unknown;
  error?: string;
}

/** Connect only to a host-created frame at the configured runtime origin. */
export class RuntimeBridge {
  private port: MessagePort | null = null;
  private frame: HTMLIFrameElement | null = null;
  private connecting: Promise<void> | null = null;
  private sequence = 0;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(
    readonly base: URL,
    private readonly onStorageRequired: () => void,
  ) {}

  async request<T>(operation: Operation, payload?: unknown): Promise<T> {
    await this.connect();
    const port = this.port;
    if (!port) throw new Error('Application storage is not connected.');

    return new Promise<T>((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Runtime request timed out.'));
      }, 30_000);

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });

      try {
        port.postMessage({ id, operation, payload });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  connect(): Promise<void> {
    if (this.port && this.frame?.isConnected) return Promise.resolve();
    if (this.connecting) return this.connecting;

    this.frame?.remove();
    const frame = document.createElement('iframe');
    this.frame = frame;
    frame.id = 'runtime-bridge';
    frame.title = 'Application storage';
    frame.hidden = true;
    frame.setAttribute('allow', 'storage-access');

    this.connecting = new Promise<void>((resolve, reject) => {
      const attempts = new Set<MessagePort>();
      let retry: ReturnType<typeof setInterval> | undefined;
      let settled = false;

      const cleanup = (keep?: MessagePort) => {
        clearInterval(retry);
        clearTimeout(timeout);
        for (const port of attempts) if (port !== keep) port.close();
        attempts.clear();
      };

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        this.disconnect(error);
        frame.remove();
        reject(error);
      };

      const timeout = setTimeout(
        () => fail(new Error('Application storage connection timed out.')),
        60_000,
      );

      frame.onerror = () => fail(new Error('Application storage could not load.'));
      frame.onload = () => {
        if (settled) {
          this.disconnect(new Error('Application storage reloaded. Try again.'));
          return;
        }

        clearInterval(retry);
        for (const port of attempts) port.close();
        attempts.clear();

        retry = setInterval(() => {
          const channel = new MessageChannel();
          attempts.add(channel.port1);
          channel.port1.onmessage = (event: MessageEvent<unknown>) => {
            const data = event.data;
            if (!data || typeof data !== 'object' || !('type' in data)) return;

            if (data.type === 'pf-storage-required') {
              frame.hidden = false;
              frame.className = 'storage-permission';
              this.onStorageRequired();
              return;
            }

            if (data.type === 'pf-error') {
              fail(
                new Error(
                  'error' in data ? String(data.error) : 'Runtime connection failed.',
                ),
              );
              return;
            }

            if (
              data.type !== 'pf-ready' ||
              !('base' in data) ||
              data.base !== this.base.href
            )
              return;

            settled = true;
            cleanup(channel.port1);
            frame.hidden = true;
            this.port = channel.port1;
            this.port.onmessage = (reply: MessageEvent<RuntimeReply>) => {
              const value = reply.data;
              if (!value || typeof value.id !== 'number') return;
              const request = this.pending.get(value.id);
              if (!request) return;
              this.pending.delete(value.id);
              clearTimeout(request.timer);
              if (value.ok === true) request.resolve(value.value);
              else request.reject(new Error(value.error || 'Runtime request failed.'));
            };
            this.port.onmessageerror = () => {
              this.disconnect(new Error('Application storage connection failed.'));
            };
            resolve();
          };

          frame.contentWindow?.postMessage({ type: 'pf-connect' }, this.base.origin, [
            channel.port2,
          ]);
        }, 200);
      };

      frame.src = new URL('connect.html', this.base).href;
      document.body.append(frame);
    });

    return this.connecting;
  }

  private disconnect(error: Error): void {
    this.port?.close();
    this.port = null;
    this.connecting = null;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }
}
