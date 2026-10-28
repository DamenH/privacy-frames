import {
  children,
  memberName,
  name,
  node,
  nodes,
  parseProgram,
  record,
  type SyntaxNode,
} from '../shared/module-source.ts';
import type {
  ScriptDependency,
  ScriptDependencyContext,
  UnresolvedScriptDependency,
} from './script-dependencies.ts';

const MAX_VALUES = 128;
const MAX_CODE_UNITS = 32 * 1024 * 1024;
interface Binding {
  expression?: SyntaxNode;
  scope: Scope;
  writes: number;
}
interface Scope {
  parent?: Scope;
  bindings: Map<string, Binding>;
}
interface Program {
  tree: SyntaxNode;
  worker: boolean;
  owner?: SyntaxNode;
}
export interface FiniteResources {
  references: ScriptDependency[];
  directoryAssumptions: number;
  assumptions: UnresolvedScriptDependency[];
}

/** Bounded over-approximation of table-driven imports, including worker-loader code. */
export function finiteResources(
  code: string,
  context: ScriptDependencyContext,
): FiniteResources {
  const result: FiniteResources = {
    references: [],
    directoryAssumptions: 0,
    assumptions: [],
  };
  if (code.length > MAX_CODE_UNITS) return result;
  const programs: Program[] = [];
  const fields = new Map<string, Set<string>>();
  const overflow = new Set<string>();
  let codeUnits = code.length;
  function field(key: string, value: unknown) {
    if (typeof value !== 'string' || !value || value.length > 512 || overflow.has(key))
      return;
    let values = fields.get(key);
    if (!values) fields.set(key, (values = new Set()));
    values.add(value);
    if (values.size > MAX_VALUES) {
      fields.delete(key);
      overflow.add(key);
    }
  }
  function data(value: unknown, depth = 0): void {
    if (!value || typeof value !== 'object' || depth > 64) return;
    if (Array.isArray(value)) {
      for (const item of value) data(item, depth + 1);
    } else {
      for (const [key, item] of Object.entries(value)) {
        field(key, item);
        data(item, depth + 1);
      }
    }
  }
  function scan(source: string, worker: boolean, owner?: SyntaxNode, depth = 0) {
    let tree: SyntaxNode;
    try {
      tree = parseProgram(source);
    } catch {
      return;
    }
    programs.push({ tree, worker, owner });
    const walk = (current: SyntaxNode) => {
      if (current.type === 'Property') {
        const key = name(current.key) || node(current.key)?.value;
        if (typeof key === 'string') field(key, node(current.value)?.value);
      }
      if (current.type === 'AssignmentExpression') {
        const left = node(current.left);
        const key = left && memberName(left);
        if (key) field(key, node(current.right)?.value);
      }
      if (current.type === 'CallExpression') {
        const args = nodes(current.arguments);
        const callee = node(current.callee);
        if (
          callee &&
          memberName(callee) === 'parse' &&
          name(callee.object) === 'JSON' &&
          typeof args[0]?.value === 'string'
        ) {
          try {
            data(JSON.parse(args[0].value));
          } catch {
            /* Not static JSON data. */
          }
        }
        // Worker-loader packages carry the actual executable source as their
        // first argument and the browser context kind as their second argument.
        if (
          depth < 2 &&
          typeof args[0]?.value === 'string' &&
          ['Worker', 'SharedWorker'].includes(String(args[1]?.value))
        ) {
          const nested = args[0].value;
          if (codeUnits + nested.length <= MAX_CODE_UNITS) {
            codeUnits += nested.length;
            scan(nested, true, owner || args[0], depth + 1);
          }
        }
      }
      for (const child of children(current)) walk(child);
    };
    walk(tree);
  }
  scan(code, context.realm === 'worker' || context.realm === 'service-worker');
  if (!programs.some((program) => program.worker)) return result;
  const emitted = new Set<string>();
  for (const program of programs.filter((program) => program.worker)) {
    const scopes = new Map<SyntaxNode, Scope>();
    const root: Scope = { bindings: new Map() };
    const lookup = (scope: Scope, key: string): Binding | undefined => {
      for (let current: Scope | undefined = scope; current; current = current.parent) {
        const binding = current.bindings.get(key);
        if (binding) return binding;
      }
    };
    function collect(current: SyntaxNode, scope: Scope) {
      if (
        ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(
          current.type,
        )
      ) {
        scope = { parent: scope, bindings: new Map() };
        for (const parameter of nodes(current.params)) {
          const key = name(parameter);
          if (key) scope.bindings.set(key, { scope, writes: 0 });
        }
      }
      scopes.set(current, scope);
      if (current.type === 'VariableDeclarator') {
        const key = name(current.id);
        if (key) {
          const existing = scope.bindings.get(key);
          scope.bindings.set(key, {
            scope,
            expression: existing ? undefined : node(current.init),
            writes: existing ? existing.writes + 1 : 0,
          });
        }
      }
      for (const child of children(current)) collect(child, scope);
    }
    collect(program.tree, root);
    function writes(current: SyntaxNode) {
      const key =
        current.type === 'AssignmentExpression'
          ? name(current.left)
          : current.type === 'UpdateExpression'
            ? name(current.argument)
            : undefined;
      if (key) {
        const binding = lookup(scopes.get(current) || root, key);
        if (binding) binding.writes++;
      }
      for (const child of children(current)) writes(child);
    }
    writes(program.tree);
    const combine = (left: string[], right: string[]) =>
      left
        .flatMap((prefix) => right.map((suffix) => prefix + suffix))
        .slice(0, MAX_VALUES);
    function values(
      expression: SyntaxNode | undefined,
      scope: Scope,
      seen = new Set<Binding>(),
      depth = 0,
    ): string[] {
      if (!expression || depth > 12) return [];
      if (expression.type === 'Literal' && typeof expression.value === 'string')
        return [expression.value];
      if (expression.type === 'Identifier') {
        const binding = lookup(scope, String(expression.name));
        if (!binding || binding.writes || seen.has(binding)) return [];
        return values(
          binding.expression,
          binding.scope,
          new Set(seen).add(binding),
          depth + 1,
        );
      }
      if (expression.type === 'MemberExpression') {
        const key = memberName(expression);
        return key ? [...(fields.get(key) || [])] : [];
      }
      if (expression.type === 'BinaryExpression' && expression.operator === '+')
        return combine(
          values(node(expression.left), scope, seen, depth + 1),
          values(node(expression.right), scope, seen, depth + 1),
        );
      if (expression.type === 'TemplateLiteral') {
        const literals = nodes(expression.quasis);
        const expressions = nodes(expression.expressions);
        let output = [''];
        for (let index = 0; index < literals.length; index++) {
          const text = record(literals[index].value)?.cooked;
          if (typeof text !== 'string') return [];
          output = output.map((prefix) => prefix + text);
          if (index < expressions.length) {
            let next = values(expressions[index], scope, seen, depth + 1);
            // A runtime-supplied URL directory cannot be recovered statically.
            // Propose the original document directory as a capture candidate;
            // this does not authorize a later network request if it is wrong.
            if (
              !next.length &&
              index === 0 &&
              text === '' &&
              String(record(literals[1]?.value)?.cooked).startsWith('/')
            ) {
              next = [
                new URL('./', context.documentURL || context.baseURL).href.replace(
                  /\/$/,
                  '',
                ),
              ];
              result.directoryAssumptions++;
              const owner = program.owner || expression;
              result.assumptions.push({
                kind: 'worker-import',
                sourceURL: context.sourceURL,
                start: owner.start,
                end: owner.end,
                reason:
                  'Conservative capture assumes the document directory for a runtime-supplied URL prefix',
              });
            }
            output = combine(output, next);
          }
        }
        return output;
      }
      return [];
    }
    function imports(current: SyntaxNode) {
      if (current.type === 'CallExpression') {
        const callee = node(current.callee);
        if (
          name(callee) === 'importScripts' ||
          (callee && memberName(callee) === 'importScripts')
        ) {
          for (const argument of nodes(current.arguments)) {
            for (const candidate of values(argument, scopes.get(current) || root)) {
              let url: URL;
              try {
                url = new URL(candidate, context.baseURL);
              } catch {
                continue;
              }
              if (!['https:', 'http:'].includes(url.protocol) || emitted.has(url.href))
                continue;
              if (emitted.size >= MAX_VALUES) return;
              emitted.add(url.href);
              const owner = program.owner || current;
              result.references.push({
                kind: 'worker-import',
                url: url.href,
                sourceURL: context.sourceURL,
                baseURL: context.baseURL,
                start: owner.start,
                end: owner.end,
              });
            }
          }
        }
      }
      for (const child of children(current)) imports(child);
    }
    imports(program.tree);
  }
  return result;
}
