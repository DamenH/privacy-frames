import test from 'node:test';
import assert from 'node:assert/strict';
import { relocateRuntimeModule } from '../src/runtime/modules.ts';

const original = 'https://publisher.test/app/module.js';
const target = 'https://runtime.test/source/app/module.js';
const resources = {
  mapURL(input: unknown): string {
    const url = new URL(String(input));
    const fragment = url.hash;
    url.hash = '';
    return (url.href === original ? target : url.href) + fragment;
  },
  isInstalledURL(input: unknown): boolean {
    const url = new URL(String(input));
    url.hash = '';
    return url.href === target;
  },
};

test('generated module imports relocate admitted resources without rewriting strings or comments', () => {
  const code = `// import '${original}'\nconst text="import '${original}'";import value from '${original}';export {value};`;
  const rewritten = relocateRuntimeModule(code, 'https://publisher.test/app/', resources);
  assert(rewritten.includes(`// import '${original}'`));
  assert(rewritten.includes(`const text="import '${original}'"`));
  assert(rewritten.includes(`import value from ${JSON.stringify(target)}`));
});

test('generated relative and dynamic imports preserve their source base and fragments', () => {
  const code = `import('./module.js#part')`;
  assert.equal(
    relocateRuntimeModule(code, 'https://publisher.test/app/', resources),
    `import(${JSON.stringify(target + '#part')})`,
  );
});

test('unknown, computed and Blob-relative imports retain native failure behavior', () => {
  for (const code of [
    `import('https://uninstalled.test/module.js')`,
    `import(computeURL())`,
    `import('./module.js')`,
  ]) {
    assert.equal(
      relocateRuntimeModule(code, 'blob:https://runtime.test/id', resources),
      code,
    );
  }
});
