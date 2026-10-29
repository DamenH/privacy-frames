import { build, type Plugin } from 'esbuild';
import { resolve } from 'node:path';

/** Build trusted code as data; it executes only in the private computation context. */
export async function trustedPolicyPlugin(root: string): Promise<Plugin> {
  const result = await build({
    entryPoints: [resolve(root, 'src/runtime/trusted/entry.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: '__trustedPolicy',
    target: 'es2022',
    banner: { js: '"use strict";' },
  });
  const source = `(() => {${result.outputFiles[0].text}\nreturn __trustedPolicy.dispatch;})()`;
  return {
    name: 'trusted-policy-source',
    setup(builder) {
      builder.onResolve({ filter: /^trusted:policy-source$/ }, () => ({
        path: 'source',
        namespace: 'trusted-policy',
      }));
      builder.onLoad({ filter: /.*/, namespace: 'trusted-policy' }, () => ({
        contents: `export default ${JSON.stringify(source)};`,
        loader: 'js',
      }));
    },
  };
}
