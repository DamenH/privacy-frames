import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build, version, type Plugin } from 'esbuild';
import ts from 'typescript';
import { trustedPolicyPlugin } from '../../scripts/trusted-policy.ts';

const root = resolve(import.meta.dirname, '../..');
const sha = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');
// Decode only a closed, literal-data ESM module; do not evaluate generated code.
function defaultString(code: string): string {
  const file = ts.createSourceFile(
    'bundle.js',
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const bindings = new Map<string, ts.Expression>();
  let exported: string | undefined;
  for (const statement of file.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        assert(
          ts.isIdentifier(declaration.name) && declaration.initializer,
          'Unexpected source export declaration',
        );
        assert(!bindings.has(declaration.name.text), 'Duplicate export binding');
        assert(
          ts.isStringLiteral(declaration.initializer) ||
            ts.isNoSubstitutionTemplateLiteral(declaration.initializer) ||
            ts.isIdentifier(declaration.initializer),
          'Source module contains executable initialization',
        );
        bindings.set(declaration.name.text, declaration.initializer);
      }
    } else if (ts.isExportDeclaration(statement)) {
      assert(
        !statement.moduleSpecifier &&
          statement.exportClause &&
          ts.isNamedExports(statement.exportClause),
      );
      assert.equal(statement.exportClause.elements.length, 1);
      const entry = statement.exportClause.elements[0];
      assert.equal(entry.name.text, 'default');
      assert(entry.propertyName && ts.isIdentifier(entry.propertyName));
      assert.equal(exported, undefined, 'Multiple default exports');
      exported = entry.propertyName.text;
    } else throw new Error('Unexpected executable source module statement');
  }
  assert(exported, 'Missing default string export');
  const seen = new Set<string>();
  while (true) {
    assert(!seen.has(exported), 'Cyclic source export');
    seen.add(exported);
    const value = bindings.get(exported);
    assert(value, 'Unbound source export');
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))
      return value.text;
    assert(ts.isIdentifier(value));
    exported = value.text;
  }
}
const expectedBuild = await build({
  absWorkingDir: root,
  entryPoints: [resolve(root, 'src/runtime/trusted/entry.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: '__trustedPolicy',
  target: 'es2022',
  banner: { js: '"use strict";' },
  metafile: true,
});
const expected = `(() => {${expectedBuild.outputFiles[0].text}\nreturn __trustedPolicy.dispatch;})()`;
const actualBuild = await build({
  absWorkingDir: root,
  stdin: {
    resolveDir: root,
    contents: "import source from 'trusted:policy-source'; export default source;",
    loader: 'ts',
  },
  plugins: [await trustedPolicyPlugin(root)],
  bundle: true,
  write: false,
  format: 'esm',
  target: 'es2022',
});
const actual = defaultString(actualBuild.outputFiles[0].text);
assert.equal(actual, expected, 'Actual plugin differs from trusted entry build');
assert.throws(
  () =>
    defaultString(
      'var value=fetch("https://example.invalid"); export {value as default};',
    ),
  /executable initialization/,
);
assert.throws(
  () => defaultString('var a=b;var b=a;export {a as default};'),
  /Cyclic source export/,
);
const wrongPlugin: Plugin = {
  name: 'test-wrong-source',
  setup(builder) {
    builder.onResolve({ filter: /^trusted:policy-source$/ }, () => ({
      path: 'wrong',
      namespace: 'wrong',
    }));
    builder.onLoad({ filter: /.*/, namespace: 'wrong' }, () => ({
      contents: 'export default "wrong-source";',
      loader: 'js',
    }));
  },
};
const wrong = await build({
  absWorkingDir: root,
  stdin: {
    resolveDir: root,
    contents: "import source from 'trusted:policy-source';export default source;",
    loader: 'ts',
  },
  plugins: [wrongPlugin],
  bundle: true,
  write: false,
  format: 'esm',
});
assert.notEqual(
  defaultString(wrong.outputFiles[0].text),
  expected,
  'Wrong-source control was indistinguishable',
);
assert(expectedBuild.metafile);
const inputs: Record<string, string> = {};
for (const name of Object.keys(expectedBuild.metafile.inputs).sort())
  inputs[name] = sha(await readFile(resolve(root, name)));
const result = {
  scope:
    'Byte correspondence and trusted-entry input provenance for the actual esbuild plugin. Not a compiler-correctness or bundled-program behavior proof.',
  esbuildVersion: version,
  checkerSHA256: sha(await readFile(import.meta.filename)),
  pluginSHA256: sha(await readFile(resolve(root, 'scripts/trusted-policy.ts'))),
  lockSHA256: sha(await readFile(resolve(root, 'package-lock.json'))),
  trustedEntry: 'src/runtime/trusted/entry.ts',
  inputs,
  sourceSHA256: sha(actual),
  sourceBytes: Buffer.byteLength(actual),
  sourceModuleSHA256: sha(actualBuild.outputFiles[0].contents),
  faultControls: {
    executableExport: 'rejected',
    cyclicExport: 'rejected',
    wrongSource: 'distinguished',
  },
  completed: true,
};
await writeFile(
  resolve(root, 'formal/implementation-navigation/build-source-result.json'),
  JSON.stringify(result, null, 2) + '\n',
);
console.log(
  `Actual virtual import matches trusted-entry bundle (${Object.keys(inputs).length} hashed input files); export controls passed`,
);
