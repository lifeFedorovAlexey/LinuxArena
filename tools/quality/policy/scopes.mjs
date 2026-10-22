import { FUNCTIONS } from './constants.mjs';
import { children } from './ast.mjs';

export function createScopes(ast) {
  const scopes = new WeakMap();
  const declarations = new WeakSet();
  const root = { parent: null, bindings: new Map(), functionScope: true };
  function bind(pattern, scope, init = null, kind = 'parameter', projection = []) {
    if (!pattern) return;
    if (pattern.type === 'Identifier') {
      declarations.add(pattern);
      scope.bindings.set(pattern.name, { init, kind, projection });
    } else if (pattern.type === 'ObjectPattern') {
      for (const property of pattern.properties) {
        if (property.type === 'RestElement') bind(property.argument, scope);
        else {
          const name = property.computed ? null : (property.key.name ?? property.key.value);
          bind(property.value, scope, init, kind, [...projection, name]);
        }
      }
    } else if (pattern.type === 'AssignmentPattern') bind(pattern.left, scope, init, kind, projection);
    else if (pattern.type === 'RestElement') bind(pattern.argument, scope);
    else if (pattern.type === 'ArrayPattern') for (const item of pattern.elements) bind(item, scope);
  }
  function visit(node, inherited) {
    let scope = inherited;
    if (node.type === 'FunctionDeclaration' && node.id) bind(node.id, scope);
    if (FUNCTIONS.has(node.type)) {
      scope = { parent: scope, bindings: new Map(), functionScope: true };
      if (node.id) bind(node.id, scope);
      for (const param of node.params) bind(param, scope);
    } else if (node.type === 'BlockStatement' || node.type === 'CatchClause' || /^For/.test(node.type)) {
      scope = { parent: scope, bindings: new Map(), functionScope: false };
      if (node.type === 'CatchClause') bind(node.param, scope);
    }
    scopes.set(node, scope);
    if (node.type === 'VariableDeclaration') {
      let target = scope;
      if (node.kind === 'var') while (!target.functionScope) target = target.parent;
      for (const declaration of node.declarations) bind(declaration.id, target, declaration.init, node.kind);
    }
    if (node.type === 'ClassDeclaration' && node.id) bind(node.id, scope);
    if (node.type === 'ImportDeclaration') {
      for (const specifier of node.specifiers) {
        bind(specifier.local, scope, null, 'import');
        const binding = scope.bindings.get(specifier.local.name);
        binding.imported =
          specifier.imported?.name ?? (specifier.type === 'ImportDefaultSpecifier' ? 'default' : '*');
        binding.module = node.source.value;
      }
    }
    for (const [child] of children(node)) visit(child, scope);
  }
  visit(ast, root);
  function lookup(node) {
    for (let scope = scopes.get(node); scope; scope = scope.parent) {
      if (scope.bindings.has(node.name)) return scope.bindings.get(node.name);
    }
    return null;
  }
  return { lookup, declarations };
}

export function isReference(node, parent, key, context) {
  if (context.declarations.has(node)) return false;
  if (!parent) return true;
  if (parent.type === 'MemberExpression' && key === 'property' && !parent.computed) return false;
  if (
    ['Property', 'MethodDefinition', 'PropertyDefinition'].includes(parent.type) &&
    key === 'key' &&
    !parent.computed
  )
    return parent.shorthand;
  if (['LabeledStatement', 'BreakStatement', 'ContinueStatement'].includes(parent.type)) return false;
  if (/^Import/.test(parent.type) || parent.type === 'ExportSpecifier') return false;
  return true;
}
