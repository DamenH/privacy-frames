import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import ts from 'typescript';
import { boundaries } from './boundaries.ts';

const root = resolve(import.meta.dirname, '../..');
const output = resolve(import.meta.dirname, 'implementation-inventory.json');
const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 1 && args[0] === '--check'));
const hash = (source: string) => createHash('sha256').update(source).digest('hex');
const contract = await readFile(resolve(root, 'formal/threat-model.md'), 'utf8');
const invariantIDs = [...contract.matchAll(/^\|\s*(C\d+)\s*\|/gm)].map(
  (match) => match[1],
);
assert.deepEqual(invariantIDs, ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8']);
assert.deepEqual(
  [...new Set(boundaries.flatMap((boundary) => boundary.invariants))].sort(),
  invariantIDs,
  'Contract invariants and the review map differ',
);
const files = [...new Set(boundaries.flatMap((boundary) => boundary.sources))].sort();
const identifiers = new Set<string>();
for (const boundary of boundaries) {
  assert(/^[a-z]+(?:-[a-z]+)*$/.test(boundary.id));
  assert(!identifiers.has(boundary.id), 'Duplicate review boundary');
  identifiers.add(boundary.id);
  assert(boundary.obligation && boundary.sources.length && boundary.invariants.length);
}

type SiteKind = 'call' | 'construct' | 'await' | 'yield' | 'return' | 'binding';
interface Site {
  kind: SiteKind;
  line: number;
  column: number;
  endLine: number;
  scopes: string[];
  syntax: string;
}

const sources = [];
for (const name of files) {
  const path = resolve(root, name);
  const local = relative(root, path);
  assert(!local.startsWith('..') && !isAbsolute(local), 'Source leaves repository');
  const source = await readFile(path, 'utf8');
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
  const sites: Site[] = [];
  function walk(node: ts.Node, scopes: string[]) {
    const position = file.getLineAndCharacterOfPosition(node.getStart(file));
    let nested = scopes;
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
    ) {
      const declared = node.name?.getText(file);
      const owner =
        ts.isVariableDeclaration(node.parent) || ts.isPropertyAssignment(node.parent)
          ? node.parent.name.getText(file)
          : undefined;
      nested = [...scopes, declared || owner || `<callback:${position.line + 1}>`];
    }
    let kind: SiteKind | undefined;
    let expression: ts.Node | undefined;
    if (ts.isCallExpression(node)) {
      kind = 'call';
      expression = node.expression;
    } else if (ts.isNewExpression(node)) {
      kind = 'construct';
      expression = node.expression;
    } else if (ts.isAwaitExpression(node)) {
      kind = 'await';
      expression = node.expression;
    } else if (ts.isYieldExpression(node)) {
      kind = 'yield';
      expression = node.expression;
    } else if (ts.isReturnStatement(node)) {
      kind = 'return';
      expression = node.expression;
    } else if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      (ts.isIdentifier(node.initializer) ||
        ts.isPropertyAccessExpression(node.initializer) ||
        ts.isElementAccessExpression(node.initializer))
    ) {
      kind = 'binding';
      expression = node;
    }
    if (kind)
      sites.push({
        kind,
        line: position.line + 1,
        column: position.character + 1,
        endLine: file.getLineAndCharacterOfPosition(node.end).line + 1,
        scopes: nested,
        syntax: expression?.getText(file).slice(0, 180) || '',
      });
    ts.forEachChild(node, (child) => walk(child, nested));
  }
  walk(file, []);
  sources.push({
    path: name,
    sourceSHA256: hash(source),
    boundaries: boundaries
      .filter((boundary) => boundary.sources.includes(name))
      .map((boundary) => boundary.id),
    sites,
  });
}

const snapshot = {
  scope:
    'Syntactic review inventory for the listed host source files. Call targets, transitive dependencies, browser effects and authority closure are not resolved. Snippets are display aids; source hashes and locations identify the inspected code.',
  fullRuntimeProofEstablished: false,
  typescriptVersion: ts.version,
  contractSHA256: hash(contract),
  generatorSHA256: hash(await readFile(import.meta.filename, 'utf8')),
  boundaryDefinitionsSHA256: hash(
    await readFile(resolve(import.meta.dirname, 'boundaries.ts'), 'utf8'),
  ),
  boundaries,
  sources,
};
const serialized = JSON.stringify(snapshot, null, 2) + '\n';
if (args[0] === '--check')
  assert.equal(
    await readFile(output, 'utf8'),
    serialized,
    'Implementation review inventory changed; inspect the source and regenerate',
  );
else await writeFile(output, serialized);
console.log(
  `${boundaries.length} review boundaries, ${sources.length} source files, ` +
    `${sources.reduce((count, source) => count + source.sites.length, 0)} syntax sites; ` +
    'authority and browser coverage remain open',
);
