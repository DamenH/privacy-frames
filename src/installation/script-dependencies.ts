import { parse } from 'acorn';

export interface ScriptExecution {
  realm: 'window' | 'worker';
  baseURL: string;
  documentURL?: string;
  moduleURL?: string;
}
export interface ScriptDependencyContext extends ScriptExecution {
  sourceURL: string;
}
export type ScriptDependencyKind =
  'worker' | 'shared-worker' | 'worker-import' | 'script';
export interface ScriptDependency {
  kind: ScriptDependencyKind;
  url: string;
  sourceURL: string;
  baseURL: string;
  start: number;
  end: number;
}
export interface UnresolvedScriptDependency {
  kind: ScriptDependencyKind | 'parse';
  sourceURL: string;
  start: number;
  end: number;
  reason: string;
}
export interface ScriptDependencies {
  references: ScriptDependency[];
  unresolved: UnresolvedScriptDependency[];
}

interface SyntaxNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}
interface Binding {
  initializer?: SyntaxNode;
  scope: Scope;
  constant: boolean;
  writes: number;
}
interface Scope {
  parent?: Scope;
  function: boolean;
  dynamic: boolean;
  bindings: Map<string, Binding>;
}
type Value = { kind: 'string' | 'url'; text: string } | { kind: 'script' };

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function node(value: unknown): SyntaxNode | undefined {
  const candidate = record(value);
  return candidate &&
    typeof candidate.type === 'string' &&
    typeof candidate.start === 'number' &&
    typeof candidate.end === 'number'
    ? (candidate as SyntaxNode)
    : undefined;
}
function nodes(value: unknown): SyntaxNode[] {
  return Array.isArray(value) ? value.flatMap((value) => node(value) ?? []) : [];
}
function children(parent: SyntaxNode): SyntaxNode[] {
  return Object.values(parent).flatMap((value) =>
    Array.isArray(value) ? nodes(value) : (node(value) ?? []),
  );
}
function name(value: unknown): string | undefined {
  const identifier = node(value);
  return identifier?.type === 'Identifier' && typeof identifier.name === 'string'
    ? identifier.name
    : undefined;
}
function memberName(member: SyntaxNode): string | undefined {
  if (member.type !== 'MemberExpression') return;
  if (!member.computed) return name(member.property);
  const property = node(member.property);
  return property?.type === 'Literal' && typeof property.value === 'string'
    ? property.value
    : undefined;
}
function lookup(scope: Scope, identifier: string): Binding | undefined {
  for (let current: Scope | undefined = scope; current; current = current.parent) {
    const binding = current.bindings.get(identifier);
    if (binding) return binding;
  }
}
function staticScope(scope: Scope): boolean {
  for (let current: Scope | undefined = scope; current; current = current.parent)
    if (current.dynamic) return false;
  return true;
}
function globalName(value: unknown, identifier: string, scope: Scope): boolean {
  return staticScope(scope) && name(value) === identifier && !lookup(scope, identifier);
}
function globalObject(value: unknown, scope: Scope): boolean {
  return ['window', 'self', 'globalThis'].some((identifier) =>
    globalName(value, identifier, scope),
  );
}
function globalMember(value: unknown, property: string, scope: Scope): boolean {
  const expression = node(value);
  return (
    globalName(value, property, scope) ||
    (!!expression &&
      memberName(expression) === property &&
      globalObject(expression.object, scope))
  );
}
function documentObject(value: unknown, scope: Scope): boolean {
  return globalMember(value, 'document', scope);
}
function functionScope(scope: Scope): Scope {
  let result = scope;
  while (!result.function && result.parent) result = result.parent;
  return result;
}

function parseProgram(code: string): SyntaxNode {
  let parsed: unknown;
  try {
    parsed = parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
  } catch {
    parsed = parse(code, { ecmaVersion: 'latest', sourceType: 'script' });
  }
  const program = node(parsed);
  if (!program) throw new Error('JavaScript parser returned an invalid program');
  return program;
}
function importMeta(value: unknown): boolean {
  const expression = node(value);
  return (
    expression?.type === 'MetaProperty' &&
    name(expression.meta) === 'import' &&
    name(expression.property) === 'meta'
  );
}
function importMetaURL(value: unknown): boolean {
  const expression = node(value);
  return (
    !!expression && memberName(expression) === 'url' && importMeta(expression.object)
  );
}
function mutableModuleMetadata(program: SyntaxNode): boolean {
  let mutable = false;
  const visit = (current: SyntaxNode, parent?: SyntaxNode): void => {
    if (
      importMeta(current) &&
      !(parent?.type === 'MemberExpression' && parent.object === current)
    )
      mutable = true;
    if (
      current.type === 'MemberExpression' &&
      importMeta(current.object) &&
      (memberName(current) === 'url' || memberName(current) === undefined) &&
      parent &&
      ((parent.type === 'AssignmentExpression' && parent.left === current) ||
        parent.type === 'UpdateExpression' ||
        (parent.type === 'UnaryExpression' && parent.operator === 'delete'))
    )
      mutable = true;
    for (const child of children(current)) visit(child, current);
  };
  visit(program);
  return mutable;
}

/** Keep asset URL construction tied to the publisher module after resource relocation. */
export function relocateImportMeta(code: string, moduleURL: string): string {
  let program: SyntaxNode;
  try {
    program = parseProgram(code);
  } catch {
    return code;
  }
  if (mutableModuleMetadata(program)) return code;
  const replacements: SyntaxNode[] = [];
  const visit = (current: SyntaxNode): void => {
    if (importMetaURL(current)) replacements.push(current);
    else for (const child of children(current)) visit(child);
  };
  visit(program);
  for (const replacement of replacements.sort((left, right) => right.start - left.start))
    code =
      code.slice(0, replacement.start) +
      '(' +
      JSON.stringify(moduleURL) +
      ')' +
      code.slice(replacement.end);
  return code;
}

/** Discover only parsed, semantically identified loading expressions; never execute code. */
export function scriptDependencies(
  code: string,
  context: ScriptDependencyContext,
): ScriptDependencies {
  const result: ScriptDependencies = { references: [], unresolved: [] };
  let program: SyntaxNode;
  try {
    program = parseProgram(code);
  } catch (error) {
    result.unresolved.push({
      kind: 'parse',
      sourceURL: context.sourceURL,
      start: 0,
      end: code.length,
      reason: error instanceof Error ? error.message : 'JavaScript parsing failed',
    });
    return result;
  }
  const mutableMetadata = mutableModuleMetadata(program);
  const root: Scope = { function: true, dynamic: false, bindings: new Map() };
  const scopes = new Map<SyntaxNode, Scope>();
  const declare = (
    pattern: SyntaxNode | undefined,
    scope: Scope,
    initializer?: SyntaxNode,
    constant = false,
  ): void => {
    if (!pattern) return;
    if (pattern.type === 'Identifier' && typeof pattern.name === 'string') {
      const previous = scope.bindings.get(pattern.name);
      scope.bindings.set(pattern.name, {
        initializer: previous ? undefined : initializer,
        scope,
        constant: !previous && constant,
        writes: 0,
      });
    } else if (pattern.type === 'RestElement') declare(node(pattern.argument), scope);
    else if (pattern.type === 'AssignmentPattern') declare(node(pattern.left), scope);
    else if (pattern.type === 'ArrayPattern')
      for (const item of nodes(pattern.elements)) declare(item, scope);
    else if (pattern.type === 'ObjectPattern')
      for (const property of nodes(pattern.properties))
        declare(
          node(property.type === 'RestElement' ? property.argument : property.value),
          scope,
        );
  };
  const index = (current: SyntaxNode, parent: Scope): void => {
    let scope = parent;
    const isFunction = [
      'FunctionDeclaration',
      'FunctionExpression',
      'ArrowFunctionExpression',
    ].includes(current.type);
    if (current.type === 'FunctionDeclaration') declare(node(current.id), parent);
    if (current.type === 'ClassDeclaration') declare(node(current.id), parent);
    if (
      isFunction ||
      [
        'BlockStatement',
        'CatchClause',
        'ForStatement',
        'ForInStatement',
        'ForOfStatement',
        'SwitchStatement',
        'ClassBody',
      ].includes(current.type)
    ) {
      scope = { parent, function: isFunction, dynamic: false, bindings: new Map() };
      if (isFunction) {
        declare(node(current.id), scope);
        for (const parameter of nodes(current.params)) declare(parameter, scope);
      }
      if (current.type === 'CatchClause') declare(node(current.param), scope);
    }
    scopes.set(current, scope);
    if (current.type === 'VariableDeclaration')
      for (const declaration of nodes(current.declarations)) {
        const owner = current.kind === 'var' ? functionScope(scope) : scope;
        declare(
          node(declaration.id),
          owner,
          node(declaration.init),
          current.kind === 'const',
        );
      }
    if (current.type === 'ImportDeclaration')
      for (const specifier of nodes(current.specifiers))
        declare(node(specifier.local), scope);
    if (current.type === 'WithStatement') {
      const object = node(current.object),
        body = node(current.body);
      if (object) index(object, scope);
      if (body)
        index(body, {
          parent: scope,
          function: false,
          dynamic: true,
          bindings: new Map(),
        });
      return;
    }
    for (const child of children(current)) index(child, scope);
  };
  index(program, root);
  for (const [current, scope] of scopes) {
    if (current.type === 'AssignmentExpression' || current.type === 'UpdateExpression') {
      const identifier = name(
        current.type === 'AssignmentExpression' ? current.left : current.argument,
      );
      const binding = identifier && lookup(scope, identifier);
      if (binding) binding.writes++;
    }
    if (current.type === 'CallExpression' && globalName(current.callee, 'eval', scope))
      functionScope(scope).dynamic = true;
  }

  const value = (
    expression: SyntaxNode | undefined,
    scope: Scope,
    visited = new Set<Binding>(),
  ): Value | undefined => {
    if (!expression || !staticScope(scope)) return;
    if (expression.type === 'Literal' && typeof expression.value === 'string')
      return { kind: 'string', text: expression.value };
    if (expression.type === 'Identifier' && typeof expression.name === 'string') {
      const binding = lookup(scope, expression.name);
      if (
        !binding?.constant ||
        binding.writes ||
        !binding.initializer ||
        visited.has(binding)
      )
        return;
      const next = new Set(visited).add(binding);
      const resolved = value(binding.initializer, binding.scope, next);
      // URL objects are mutable; only primitive strings and immutable DOM node kind propagate.
      return resolved?.kind === 'url' ? undefined : resolved;
    }
    if (expression.type === 'BinaryExpression' && expression.operator === '+') {
      const left = value(node(expression.left), scope, visited),
        right = value(node(expression.right), scope, visited);
      if (left?.kind === 'string' && right?.kind === 'string')
        return { kind: 'string', text: left.text + right.text };
    }
    if (expression.type === 'TemplateLiteral') {
      const quasis = nodes(expression.quasis),
        expressions = nodes(expression.expressions);
      let text = '';
      for (let index = 0; index < quasis.length; index++) {
        const cooked = record(quasis[index].value)?.cooked;
        if (typeof cooked !== 'string') return;
        text += cooked;
        if (index < expressions.length) {
          const part = value(expressions[index], scope, visited);
          if (part?.kind !== 'string') return;
          text += part.text;
        }
      }
      return { kind: 'string', text };
    }
    if (expression.type === 'MemberExpression') {
      const property = memberName(expression),
        object = node(expression.object);
      if (
        !mutableMetadata &&
        property === 'url' &&
        object?.type === 'MetaProperty' &&
        name(object.meta) === 'import' &&
        name(object.property) === 'meta'
      )
        return { kind: 'string', text: context.moduleURL || context.sourceURL };
      if (
        property === 'baseURI' &&
        context.realm === 'window' &&
        documentObject(object, scope)
      )
        return { kind: 'string', text: context.baseURL };
      if (property === 'href') {
        const isLocation = globalMember(object, 'location', scope);
        if (isLocation)
          return {
            kind: 'string',
            text:
              context.realm === 'worker'
                ? context.baseURL
                : context.documentURL || context.baseURL,
          };
        const resolved = value(object, scope, visited);
        if (resolved?.kind === 'url') return { kind: 'string', text: resolved.text };
      }
    }
    if (
      expression.type === 'NewExpression' &&
      globalMember(expression.callee, 'URL', scope)
    ) {
      const args = nodes(expression.arguments),
        input = value(args[0], scope, visited);
      const base = args[1] && value(args[1], scope, visited);
      if (
        !input ||
        input.kind === 'script' ||
        (args[1] && (!base || base.kind === 'script'))
      )
        return;
      try {
        return {
          kind: 'url',
          text: new URL(
            input.text,
            base && base.kind !== 'script' ? base.text : undefined,
          ).href,
        };
      } catch {
        return;
      }
    }
    if (expression.type === 'CallExpression') {
      const callee = node(expression.callee);
      if (
        context.realm === 'window' &&
        callee &&
        memberName(callee) === 'createElement' &&
        documentObject(callee.object, scope)
      ) {
        const argument = value(nodes(expression.arguments)[0], scope, visited);
        if (argument?.kind === 'string' && argument.text.toLowerCase() === 'script')
          return { kind: 'script' };
      }
    }
  };
  const add = (
    kind: ScriptDependencyKind,
    expression: SyntaxNode | undefined,
    owner: SyntaxNode,
    scope: Scope,
  ): void => {
    const resolved = value(expression, scope);
    const unresolved = (reason: string) =>
      result.unresolved.push({
        kind,
        sourceURL: context.sourceURL,
        start: owner.start,
        end: owner.end,
        reason,
      });
    if (!resolved || resolved.kind === 'script') {
      unresolved('Resource URL is not a supported constant expression');
      return;
    }
    let url: URL;
    try {
      url = new URL(resolved.text, context.baseURL);
    } catch {
      unresolved('Resource URL cannot be resolved');
      return;
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      unresolved('Resource source requires runtime capture rather than an HTTP download');
      return;
    }
    url.hash = '';
    result.references.push({
      kind,
      url: url.href,
      sourceURL: context.sourceURL,
      baseURL: context.baseURL,
      start: owner.start,
      end: owner.end,
    });
  };
  for (const [current, scope] of scopes) {
    if (current.type === 'NewExpression') {
      const kind = globalMember(current.callee, 'Worker', scope)
        ? 'worker'
        : globalMember(current.callee, 'SharedWorker', scope)
          ? 'shared-worker'
          : null;
      if (kind) add(kind, nodes(current.arguments)[0], current, scope);
    }
    if (
      current.type === 'CallExpression' &&
      globalMember(current.callee, 'importScripts', scope) &&
      context.realm === 'worker'
    )
      for (const argument of nodes(current.arguments))
        add('worker-import', argument, current, scope);
    if (current.type === 'AssignmentExpression' && current.operator === '=') {
      const target = node(current.left);
      if (
        target &&
        memberName(target) === 'src' &&
        value(node(target.object), scope)?.kind === 'script'
      )
        add('script', node(current.right), current, scope);
    }
    if (current.type === 'CallExpression') {
      const target = node(current.callee);
      if (
        target &&
        memberName(target) === 'setAttribute' &&
        value(node(target.object), scope)?.kind === 'script'
      ) {
        const args = nodes(current.arguments),
          attribute = value(args[0], scope);
        if (attribute?.kind === 'string' && attribute.text.toLowerCase() === 'src')
          add('script', args[1], current, scope);
      }
    }
  }
  return result;
}
