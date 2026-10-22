import { UNKNOWN } from './constants.mjs';

export function staticValue(node, context, seen = new Set()) {
  if (!node || seen.has(node)) return UNKNOWN;
  const next = new Set(seen).add(node);
  if (node.type === 'Literal') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  if (node.type === 'Identifier') {
    const binding = context.lookup(node);
    return binding?.kind === 'const' && !binding.projection.length
      ? staticValue(binding.init, context, next)
      : UNKNOWN;
  }
  if (node.type === 'MemberExpression') {
    const path = globalPath(node, context, seen);
    if (path?.join('.') === 'process.env.REQUIRE_NATIVE_ENGINE') return '1';
  }
  if (node.type === 'UnaryExpression') {
    const value = staticValue(node.argument, context, next);
    if (value === UNKNOWN) return UNKNOWN;
    if (node.operator === '!') return !value;
    if (node.operator === 'void') return undefined;
    if (node.operator === '+') return Number(value);
    if (node.operator === '-') return -value;
  }
  if (node.type === 'LogicalExpression') {
    const left = staticValue(node.left, context, next);
    if (left === UNKNOWN) return UNKNOWN;
    if (node.operator === '&&') return left ? staticValue(node.right, context, next) : left;
    if (node.operator === '||') return left ? left : staticValue(node.right, context, next);
    return left == null ? staticValue(node.right, context, next) : left;
  }
  if (node.type === 'ConditionalExpression') {
    const test = staticValue(node.test, context, next);
    return test === UNKNOWN ? UNKNOWN : staticValue(test ? node.consequent : node.alternate, context, next);
  }
  if (node.type === 'BinaryExpression') {
    const left = staticValue(node.left, context, next);
    const right = staticValue(node.right, context, next);
    if (left === UNKNOWN || right === UNKNOWN) return UNKNOWN;
    if (node.operator === '+') {
      if (
        (typeof left === 'bigint') !== (typeof right === 'bigint') &&
        typeof left !== 'string' &&
        typeof right !== 'string'
      )
        return UNKNOWN;
      return left + right;
    }
    if (node.operator === '===') return left === right;
    if (node.operator === '!==') return left !== right;
  }
  return UNKNOWN;
}

export function propertyName(node, context, seen = new Set()) {
  return node.computed
    ? staticValue(node.property ?? node.key, context, seen)
    : ((node.property ?? node.key)?.name ?? node.key?.value);
}

export function globalPath(node, context, seen = new Set()) {
  if (!node || seen.has(node)) return null;
  const next = new Set(seen).add(node);
  if (node.type === 'Identifier') {
    const binding = context.lookup(node);
    if (!binding) return [node.name];
    if (binding.kind !== 'const') return null;
    const path = globalPath(binding.init, context, next);
    return path && binding.projection.every((part) => part !== null)
      ? [...path, ...binding.projection]
      : null;
  }
  if (node.type === 'MemberExpression') {
    const path = globalPath(node.object, context, next);
    const property = propertyName(node, context, next);
    return path && property !== UNKNOWN ? [...path, String(property)] : null;
  }
  if (node.type === 'ChainExpression') return globalPath(node.expression, context, next);
  return null;
}
