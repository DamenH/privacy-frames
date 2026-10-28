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
  ScriptDependencies,
  ScriptDependencyContext,
  ScriptDependencyKind,
} from './script-dependencies.ts';

const globals = new Set(['self', 'window', 'globalThis']);
const functions = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);
const reserved = new Set(['require', 'exports', 'module']);

function globalProperty(expression: SyntaxNode | undefined): string | undefined {
  return expression?.type === 'MemberExpression' &&
    globals.has(name(expression.object) || '')
    ? memberName(expression)
    : undefined;
}

/** Discover AMD dependencies without invoking a publisher loader or factory. */
export function amdDependencies(
  code: string,
  context: ScriptDependencyContext,
): ScriptDependencies & { loader: boolean } {
  const program = parseProgram(code);
  const result: ScriptDependencies & { loader: boolean } = {
    references: [],
    unresolved: [],
    loader: false,
  };
  const bindings = new Map<string, SyntaxNode>();
  const metadata = new Map<string, SyntaxNode[]>();
  const loaderReads = new Set<string>();
  const locationURL = new URL(context.documentURL || context.baseURL);
  const text = (
    expression: SyntaxNode | undefined,
    seen = new Set<string>(),
  ): string | undefined => {
    if (!expression) return;
    if (expression.type === 'Literal' && typeof expression.value === 'string')
      return expression.value;
    if (expression.type === 'Identifier') {
      const key = name(expression);
      if (!key || seen.has(key)) return;
      return text(bindings.get(key), new Set(seen).add(key));
    }
    if (expression.type === 'BinaryExpression' && expression.operator === '+') {
      const left = text(node(expression.left), seen),
        right = text(node(expression.right), seen);
      if (left !== undefined && right !== undefined) return left + right;
    }
    if (expression.type === 'TemplateLiteral') {
      const quasis = nodes(expression.quasis),
        expressions = nodes(expression.expressions);
      let value = '';
      for (let index = 0; index < quasis.length; index++) {
        const part = record(quasis[index].value)?.cooked;
        if (typeof part !== 'string') return;
        value += part;
        if (index < expressions.length) {
          const substitution = text(expressions[index], seen);
          if (substitution === undefined) return;
          value += substitution;
        }
      }
      return value;
    }
    if (expression.type === 'MemberExpression') {
      const object = node(expression.object);
      const key = memberName(expression);
      if (name(object) === 'location' || globalProperty(object) === 'location') {
        if (key === 'origin') return locationURL.origin;
        if (key === 'href') return locationURL.href;
      }
    }
  };
  const scanLoader = (current: SyntaxNode) => {
    const property = globalProperty(current);
    if (property) loaderReads.add(property);
    for (const child of children(current)) scanLoader(child);
  };
  // Some bundlers inline a module and pass its logical address through a global
  // property read by their define implementation. Follow that data relationship,
  // rather than assigning meaning to a particular metadata property name.
  const scanTop = (current: SyntaxNode) => {
    if (functions.has(current.type)) return;
    if (current.type === 'VariableDeclarator') {
      const identifier = name(current.id),
        initializer = node(current.init);
      if (identifier && initializer) bindings.set(identifier, initializer);
    }
    if (current.type === 'AssignmentExpression' && current.operator === '=') {
      const key = globalProperty(node(current.left)),
        value = node(current.right);
      if (key && value) {
        if (key === 'define' && functions.has(value.type)) {
          result.loader = true;
          scanLoader(value);
        } else {
          const entries = metadata.get(key) || [];
          entries.push(value);
          metadata.set(key, entries);
        }
      }
    }
    for (const child of children(current)) scanTop(child);
  };
  scanTop(program);
  const bases = new Set<string>();
  for (const key of loaderReads) {
    const candidates = metadata.get(key);
    for (const expression of candidates?.slice(0, 32) || []) {
      const candidate = text(expression);
      if (!candidate) continue;
      try {
        const url = new URL(candidate, context.baseURL);
        if (['http:', 'https:'].includes(url.protocol) && /\.m?js$/i.test(url.pathname))
          bases.add(url.href);
      } catch {
        /* An unresolved loader hint conveys no resource authority. */
      }
    }
  }
  if (!bases.size) bases.add(context.moduleURL || context.sourceURL);
  const add = (
    specifier: SyntaxNode,
    owner: SyntaxNode,
    kind: ScriptDependencyKind = 'script',
    appendExtension = true,
  ) => {
    const value = text(specifier);
    if (!value) {
      result.unresolved.push({
        kind: 'script',
        sourceURL: context.sourceURL,
        start: owner.start,
        end: owner.end,
        reason: 'AMD dependency requires runtime resolution',
      });
      return;
    }
    if (reserved.has(value)) return;
    // Plugin IDs and bare package IDs depend on loader configuration.
    if (!/^(?:\.{1,2}\/|\/|https?:\/\/)/.test(value) || value.includes('!')) return;
    for (const base of bases) {
      const url = new URL(value, base);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        continue;
      if (appendExtension && !/\.[a-z0-9]+$/i.test(url.pathname)) url.pathname += '.js';
      url.hash = '';
      result.references.push({
        kind,
        url: url.href,
        sourceURL: context.sourceURL,
        baseURL: base,
        start: owner.start,
        end: owner.end,
      });
    }
  };
  const declarations = (current: SyntaxNode, names: Set<string>) => {
    if (functions.has(current.type)) {
      if (current.type === 'FunctionDeclaration' && name(current.id))
        names.add(name(current.id)!);
      return;
    }
    if (current.type === 'VariableDeclarator' && name(current.id))
      names.add(name(current.id)!);
    for (const child of children(current)) declarations(child, names);
  };
  const scanFactory = (
    current: SyntaxNode,
    parameters: { require?: string; module?: string; exports?: string },
    parent?: SyntaxNode,
  ) => {
    if (functions.has(current.type)) {
      const locals = new Set(
        nodes(current.params).flatMap((parameter) => name(parameter) || []),
      );
      declarations(node(current.body)!, locals);
      parameters = {
        require:
          parameters.require && !locals.has(parameters.require)
            ? parameters.require
            : undefined,
        module:
          parameters.module && !locals.has(parameters.module)
            ? parameters.module
            : undefined,
        exports:
          parameters.exports && !locals.has(parameters.exports)
            ? parameters.exports
            : undefined,
      };
    }
    if (
      parameters.require &&
      current.type === 'CallExpression' &&
      name(current.callee) === parameters.require
    ) {
      const argument = nodes(current.arguments)[0];
      if (argument?.type === 'ArrayExpression')
        for (const item of nodes(argument.elements)) add(item, current);
      else if (argument) add(argument, current);
    }
    if (current.type === 'NewExpression' && name(current.callee) === 'URL') {
      const args = nodes(current.arguments),
        base = args[1];
      if (
        base?.type === 'MemberExpression' &&
        memberName(base) === 'uri' &&
        parameters.module &&
        name(base.object) === parameters.module &&
        args[0]
      ) {
        const worker =
          parent?.type === 'NewExpression' &&
          ['Worker', 'SharedWorker'].includes(name(parent.callee) || '');
        add(
          args[0],
          current,
          worker
            ? name(parent!.callee) === 'SharedWorker'
              ? 'shared-worker'
              : 'worker'
            : 'resource',
          false,
        );
      }
    }
    if (current.type === 'AssignmentExpression' && current.operator === '=') {
      const target = node(current.left),
        value = text(node(current.right));
      if (
        target?.type === 'MemberExpression' &&
        parameters.exports &&
        name(target.object) === parameters.exports &&
        value &&
        /^(?:\.{1,2}\/|\/|https?:\/\/)/.test(value)
      ) {
        try {
          if (/\.[a-z0-9]{1,8}$/i.test(new URL(value, context.baseURL).pathname))
            add(node(current.right)!, current, 'resource', false);
        } catch {
          /* Invalid export text is not a resource reference. */
        }
      }
    }
    for (const child of children(current)) scanFactory(child, parameters, current);
  };
  const visit = (current: SyntaxNode, shadowed = false) => {
    if (functions.has(current.type)) {
      const locals = new Set(
        nodes(current.params).flatMap((parameter) => name(parameter) || []),
      );
      declarations(node(current.body)!, locals);
      shadowed ||= locals.has('define');
    }
    if (
      current.type === 'CallExpression' &&
      !shadowed &&
      (name(current.callee) === 'define' ||
        globalProperty(node(current.callee)) === 'define')
    ) {
      const args = nodes(current.arguments);
      const offset =
        args[0]?.type === 'Literal' && typeof args[0].value === 'string' ? 1 : 0;
      const dependencies =
        args[offset]?.type === 'ArrayExpression' ? nodes(args[offset].elements) : [];
      const factory =
        args[offset]?.type === 'ArrayExpression' ? args[offset + 1] : args[offset];
      for (const dependency of dependencies) add(dependency, current);
      if (factory && functions.has(factory.type)) {
        const parameter = (kind: string, implicit: number) => {
          const index = dependencies.length
            ? dependencies.findIndex((item) => text(item) === kind)
            : implicit;
          return index < 0 ? undefined : name(nodes(factory.params)[index]);
        };
        const body = node(factory.body);
        if (body)
          scanFactory(body, {
            require: parameter('require', 0),
            exports: parameter('exports', 1),
            module: parameter('module', 2),
          });
      }
    }
    for (const child of children(current)) visit(child, shadowed);
  };
  const rootNames = new Set<string>();
  declarations(program, rootNames);
  visit(program, rootNames.has('define'));
  result.references = [
    ...new Map(
      result.references.map((item) => [item.kind + ':' + item.url, item]),
    ).values(),
  ];
  return result;
}
