import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';
import { gillianImage, verifyFixture } from './gillian.ts';

const root = resolve(import.meta.dirname, '../..');
const directory = resolve(root, '.tools/document-publication');
const receipt = resolve(import.meta.dirname, 'document-publication-result.json');
await rm(receipt, { force: true });
const sourcePath = 'src/runtime/contexts/document-publication.ts';
const source = await readFile(resolve(root, sourcePath), 'utf8');
const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true);
const names = ['beginDocumentPublication', 'cancelDocumentPublication'] as const;
const functions = new Map<string, string>();
for (const statement of file.statements) {
  if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement))
    continue;
  assert(ts.isFunctionDeclaration(statement) && statement.name && statement.body);
  assert(!statement.asteriskToken);
  assert.deepEqual(
    statement.modifiers?.map((modifier) => modifier.kind),
    [ts.SyntaxKind.ExportKeyword],
  );
  assert.equal(statement.parameters.length, 1);
  const parameter = statement.parameters[0];
  assert(ts.isIdentifier(parameter.name) && parameter.name.text === 'state');
  assert(!parameter.initializer && !parameter.dotDotDotToken);
  functions.set(statement.name.text, statement.getText(file).replace(/^export /, ''));
}
assert.deepEqual([...functions.keys()].sort(), [...names]);

const predicate = `/**
@pred Publication(o:Obj; generation:Obj, started:Bool, ready:Bool, published:Bool, loaded:Bool, proto):
 JSObjWithProto(o, proto) * DataProp(o, "generation", generation) *
 DataProp(o, "started", started) * DataProp(o, "ready", ready) *
 DataProp(o, "published", published) * DataProp(o, "loaded", loaded);
*/
`;
const precondition =
  '(state == #state) * Publication(#state, #old, #started, #ready, #published, #loaded, #proto) * JSObject(#old)';
function fixture(mutate?: (name: string, code: string) => string) {
  let output = "'use strict';\n" + predicate;
  for (const [name, original] of functions) {
    const compiled = ts.transpileModule(mutate ? mutate(name, original) : original, {
      compilerOptions: {
        target: ts.ScriptTarget.ES5,
        module: ts.ModuleKind.CommonJS,
        removeComments: true,
        ignoreDeprecations: '6.0',
      },
      reportDiagnostics: true,
    });
    assert.equal(compiled.diagnostics?.length, 0);
    const erased = ts.createSourceFile(
      name + '.js',
      compiled.outputText,
      ts.ScriptTarget.Latest,
      true,
    );
    const declarations = erased.statements.filter(ts.isFunctionDeclaration);
    assert.equal(declarations.length, 1);
    assert.equal(declarations[0].name?.text, name);
    assert(
      erased.statements.every(
        (statement) =>
          ts.isFunctionDeclaration(statement) ||
          (ts.isExpressionStatement(statement) &&
            ts.isStringLiteral(statement.expression) &&
            statement.expression.text === 'use strict'),
      ),
    );
    const postcondition =
      name === 'cancelDocumentPublication'
        ? 'Publication(#state, #next, false, false, false, false, #proto) * JSObject(#old) * JSObject(#next) * (! (#next == #old)) * (ret == undefined)'
        : 'Publication(#state, #next, true, #ready, #published, false, #proto) * JSObject(#old) * JSObject(#next) * (! (#next == #old)) * (ret == #next)';
    // Keep the annotation adjacent to its function. A transpiler directive here
    // would attach the annotation to the directive instead of the procedure.
    output += `/**\n@id ${name}\n@pre ${precondition}\n@post ${postcondition}\n*/\n`;
    output += declarations[0].getText(erased) + '\n';
  }
  return output;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const production = fixture();
const results = [];
results.push(
  await verifyFixture({
    directory,
    name: 'production',
    code: production,
    procedures: names,
  }),
);
const faults = [
  {
    name: 'cancel-keeps-generation',
    procedure: 'cancelDocumentPublication',
    from: 'state.generation = {};',
    to: 'state.generation = state.generation;',
  },
  {
    name: 'cancel-keeps-ready',
    procedure: 'cancelDocumentPublication',
    from: 'state.ready = false;',
    to: 'state.ready = true;',
  },
  {
    name: 'begin-reuses-generation',
    procedure: 'beginDocumentPublication',
    from: 'const generation = {};',
    to: 'const generation = state.generation;',
  },
  {
    name: 'begin-keeps-loaded',
    procedure: 'beginDocumentPublication',
    from: 'state.loaded = false;',
    to: '',
  },
  {
    name: 'begin-corrupts-ready',
    procedure: 'beginDocumentPublication',
    from: 'state.started = true;',
    to: 'state.started = true;\nstate.ready = false;',
  },
];
for (const fault of faults) {
  const code = fixture((name, body) => {
    if (name !== fault.procedure) return body;
    assert.equal(body.split(fault.from).length, 2, 'Fault anchor changed');
    return body.replace(fault.from, fault.to);
  });
  results.push(
    await verifyFixture({
      directory,
      name: fault.name,
      code,
      procedures: names,
      failedProcedure: fault.procedure,
    }),
  );
}
const displaced = production.replaceAll('*/\nfunction', '*/\n"use strict";\nfunction');
assert.notEqual(displaced, production);
await assert.rejects(
  verifyFixture({
    directory,
    name: 'displaced-annotations',
    code: displaced,
    procedures: names,
  }),
  /Wrong number of procedure contracts checked/,
);
const displacedLog = await readFile(
  resolve(directory, 'displaced-annotations.log'),
  'utf8',
);
assert(displacedLog.includes('Obtained 0 symbolic tests in total'));
assert.equal(await readFile(resolve(root, sourcePath), 'utf8'), source);
await writeFile(
  receipt,
  JSON.stringify(
    {
      scope:
        'Deductive verification of the two production document-publication state functions after TypeScript erasure. This is not proof of the complete factory, caller ownership, browser publication or effect coverage.',
      mode: 'verify',
      image: gillianImage,
      imageSourceRevision: 'not-identified',
      typescriptVersion: ts.version,
      source: sourcePath,
      sourceSHA256: hash(source),
      factorySHA256: hash(
        await readFile(resolve(root, 'src/runtime/contexts/document-factory.ts'), 'utf8'),
      ),
      runnerSHA256: hash(await readFile(import.meta.filename, 'utf8')),
      preconditions: [
        'The private record has an arbitrary prototype and owns writable data properties for the generation and four Boolean flags.',
        'The retained old generation is an ordinary JavaScript object distinct from the state record.',
        'Other heap resources are protected by the verifier framing discipline; caller ownership and native adapters need separate proofs.',
        'TypeScript erasure, extraction, Gillian JavaScript semantics, verifier and solver remain trusted.',
      ],
      results,
      vacuousAnnotationControl: {
        disposition: 'rejected-by-runner',
        inputSHA256: hash(displaced),
        outputSHA256: hash(displacedLog),
        observedProcedureCount: 0,
      },
      completedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'Two production publication contracts verified; five postcondition faults and vacuous annotations rejected',
);
