import { FUNCTIONS, CONTROLS, TEST_FILE, FIXTURE_FILE } from './constants.mjs';
import { children, walk } from './ast.mjs';

export function functionMetrics(fn) {
  const metrics = { complexity: 1, nesting: 0, statements: 0, nodes: 0 };
  function visit(node, depth) {
    if (FUNCTIONS.has(node.type) && node !== fn) return;
    metrics.nodes += 1;
    if (/Statement$/.test(node.type) && !['BlockStatement', 'EmptyStatement'].includes(node.type))
      metrics.statements += 1;
    if (
      [
        'IfStatement',
        'ConditionalExpression',
        'LogicalExpression',
        'CatchClause',
        'ForStatement',
        'ForInStatement',
        'ForOfStatement',
        'WhileStatement',
        'DoWhileStatement',
      ].includes(node.type) ||
      (node.type === 'SwitchCase' && node.test)
    )
      metrics.complexity += 1;
    const nesting = depth + (CONTROLS.has(node.type) ? 1 : 0);
    metrics.nesting = Math.max(metrics.nesting, nesting);
    for (const [child] of children(node)) visit(child, nesting);
  }
  visit(fn, 0);
  return metrics;
}

export function fingerprint(node) {
  return JSON.stringify(node, (key, value) =>
    ['start', 'end', 'loc', 'raw'].includes(key)
      ? undefined
      : typeof value === 'bigint'
        ? `${value}n`
        : value,
  );
}

export function reviewFunctions(file, ast, duplicates, add) {
  if (TEST_FILE.test(file) || FIXTURE_FILE.test(file)) return;
  walk(ast, (node) => {
    if (!FUNCTIONS.has(node.type)) return;
    const metrics = functionMetrics(node);
    if (metrics.complexity > 20 || metrics.nesting > 5 || metrics.statements > 80)
      add(
        node.loc.start.line,
        'REVIEW_REQUIRED',
        'function-complexity',
        `Function ${node.id?.name ?? '(anonymous)'}: cyclomatic=${metrics.complexity}, control nesting=${metrics.nesting}, executable statements=${metrics.statements}; thresholds are 20, 5 and 80.`,
        'Review behavior and test evidence for this exact function; simplify only where doing so improves clarity.',
      );
    if (metrics.nodes < 80 || metrics.statements < 8) return;
    const key = fingerprint(node.body);
    if (duplicates.has(key)) {
      const original = duplicates.get(key);
      add(
        node.loc.start.line,
        'REVIEW_REQUIRED',
        'duplicate-function-body',
        `Exact substantial function body also appears at ${original.file}:${original.line}.`,
        'Review whether a shared implementation is appropriate or document why independent copies are required.',
      );
    } else duplicates.set(key, { file, line: node.loc.start.line });
  });
}
