import { downloadWebsite } from './import-website.ts';
import { errorMessage } from './protocol.ts';
import {
  installationConfiguration,
  installationRequest,
  installationSession,
} from './session.ts';

const configuration = fetch(new URL('config.json', import.meta.url), {
  credentials: 'omit',
}).then(async (response) => {
  if (!response.ok) throw new Error('Installation configuration unavailable');
  const value: unknown = await response.json();
  return installationConfiguration(value, location.origin);
});
// Failed configuration never grants a preparation channel.
void configuration.catch(() => {});
let connected = false;

addEventListener('message', async (event: MessageEvent<unknown>) => {
  const request = installationSession(event.data);
  const port = event.ports[0];
  if (
    connected ||
    !request ||
    !port ||
    event.ports.length !== 1 ||
    event.source !== parent ||
    parent === window
  )
    return;
  try {
    if (event.origin !== (await configuration) || connected) return;
    connected = true;
    let started = false;
    const session = request.session;
    port.onmessage = async (message: MessageEvent<unknown>) => {
      if (started) return;
      started = true;
      try {
        const url = installationRequest(message.data, session);
        const installation = await downloadWebsite(url, {
          onProgress: (progress) =>
            port.postMessage({
              type: 'progress',
              session,
              message: progress.slice(0, 2000),
            }),
        });
        port.postMessage(
          { type: 'prepared', session, installation },
          installation.resources.map((resource) => resource.bytes),
        );
      } catch (error) {
        port.postMessage({
          type: 'failed',
          session,
          error: errorMessage(error).slice(0, 2000),
        });
      } finally {
        port.close();
      }
    };
    port.start();
    port.postMessage({ type: 'ready', session });
  } catch {
    port.close();
  }
});
