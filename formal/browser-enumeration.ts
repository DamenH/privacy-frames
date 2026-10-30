import http from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';
import { launch } from '../test/browser-profile.ts';

// An unrestricted same-device page lists property names without invoking getters.
// Enumeration is discovery evidence, not a classification or a confinement test.
const server = http.createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end('<!doctype html><title>Browser interface inventory</title>');
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Missing inventory server');
const browsers: object[] = [];
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    try {
      const page = await browser.newPage();
      await page.goto('http://127.0.0.1:' + address.port);
      const surfaces = await page.evaluate(async () => {
        function ownNames(value: object): string[] {
          return Object.getOwnPropertyNames(value).sort();
        }
        function chain(value: object): string[][] {
          const result: string[][] = [];
          for (let p: object | null = value; p; p = Object.getPrototypeOf(p))
            result.push(ownNames(p));
          return result;
        }
        function constructors(value: object): Record<string, string[]> {
          const output: Record<string, string[]> = {};
          for (const [key, descriptor] of Object.entries(
            Object.getOwnPropertyDescriptors(value),
          )) {
            const candidate = descriptor.value;
            if (typeof candidate !== 'function') continue;
            const prototype = Object.getOwnPropertyDescriptor(
              candidate,
              'prototype',
            )?.value;
            if (prototype && typeof prototype === 'object')
              output[key] = ownNames(prototype);
          }
          return output;
        }
        const workerCode = `const names=o=>Object.getOwnPropertyNames(o).sort();const constructors=o=>{const out={};for(const [key,descriptor] of Object.entries(Object.getOwnPropertyDescriptors(o))){const value=descriptor.value;if(typeof value!=='function')continue;const prototype=Object.getOwnPropertyDescriptor(value,'prototype')?.value;if(prototype&&typeof prototype==='object')out[key]=names(prototype)}return out};const chain=[];for(let p=self;p;p=Object.getPrototypeOf(p))chain.push(names(p));postMessage({chain,constructors:constructors(self)});`;
        const workerURL = URL.createObjectURL(
          new Blob([workerCode], { type: 'text/javascript' }),
        );
        const worker = new Worker(workerURL);
        try {
          const workerSurface = await new Promise((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error('Worker inventory timed out')),
              10000,
            );
            worker.onmessage = (event) => {
              clearTimeout(timeout);
              resolve(event.data);
            };
            worker.onerror = (event) => {
              clearTimeout(timeout);
              reject(new Error(event.message));
            };
          });
          return {
            secureContext: isSecureContext,
            window: chain(window),
            navigator: chain(navigator),
            document: chain(document),
            windowConstructors: constructors(window),
            worker: workerSurface,
          };
        } finally {
          worker.terminate();
          URL.revokeObjectURL(workerURL);
        }
      });
      browsers.push({ name, version: browser.version(), surfaces });
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
const source = await readFile(new URL(import.meta.url));
await writeFile(
  'formal/browser-features.json',
  JSON.stringify(
    {
      scope:
        'Unrestricted localhost Window, Navigator, Document and dedicated Worker property names and constructor prototype names. Getters are not invoked; this does not establish reachability, behavior, security policy, or completeness of other contexts.',
      revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      runnerSHA256: createHash('sha256').update(source).digest('hex'),
      browsers,
    },
    null,
    2,
  ) + '\n',
);
console.log('Native browser feature names recorded for Chromium and Firefox');
