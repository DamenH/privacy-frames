import { installationReply } from '../../installation/session.ts';

/** A fresh cross-origin collector is used once, then removed before admission. */
export class InstallationBridge {
  constructor(readonly base: URL) {}

  async install<T>(
    url: string,
    onProgress: (message: string) => void,
    admit: (installation: unknown) => Promise<T>,
  ): Promise<T> {
    if (!navigator.locks) throw new Error('Installation requires browser lock support.');
    onProgress('Waiting for installation…');
    // Held through runtime admission, across manager tabs in this storage partition.
    return navigator.locks.request('privacy-frames-installation', async () => {
      const installation = await this.prepare(url, onProgress);
      return admit(installation);
    });
  }

  private prepare(url: string, onProgress: (message: string) => void): Promise<unknown> {
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.id = 'installation-bridge';
    frame.title = 'Application installation';
    frame.referrerPolicy = 'no-referrer';
    const session = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      let channel: MessageChannel | undefined;
      let ready = false;
      let loaded = false;
      let settled = false;
      const finish = (error?: Error, installation?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        channel?.port1.close();
        channel?.port2.close();
        frame.remove();
        if (error) reject(error);
        else resolve(installation);
      };
      const timer = setTimeout(
        () => finish(new Error('Installation preparation timed out.')),
        300_000,
      );
      frame.onerror = () => finish(new Error('Installation origin could not load.'));
      frame.onload = () => {
        if (loaded) {
          finish(new Error('Installation origin navigated during preparation.'));
          return;
        }
        loaded = true;
        channel = new MessageChannel();
        channel.port1.onmessage = (event: MessageEvent<unknown>) => {
          try {
            const reply = installationReply(event.data, session);
            if (reply.type === 'ready') {
              if (ready) throw new Error('Installation session was already started.');
              ready = true;
              channel?.port1.postMessage({ type: 'prepare', session, url });
            } else {
              if (!ready) throw new Error('Installation session is not ready.');
              if (reply.type === 'progress') onProgress(reply.message);
              if (reply.type === 'failed') finish(new Error(reply.error));
              if (reply.type === 'prepared') finish(undefined, reply.installation);
            }
          } catch (error) {
            finish(error instanceof Error ? error : new Error('Installation failed.'));
          }
        };
        channel.port1.onmessageerror = () =>
          finish(new Error('Invalid installation response.'));
        channel.port1.start();
        frame.contentWindow?.postMessage(
          { type: 'pf-install-connect', session },
          this.base.origin,
          [channel.port2],
        );
      };
      frame.src = this.base.href;
      document.body.append(frame);
    });
  }
}
