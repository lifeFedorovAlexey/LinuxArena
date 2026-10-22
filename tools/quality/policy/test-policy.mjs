import { UNKNOWN, TEST_NAMES, TEST_MODIFIERS } from './constants.mjs';
import { staticValue, propertyName, globalPath } from './values.mjs';

export function testRoot(node, context, seen = new Set()) {
  if (!node || seen.has(node)) return false;
  const next = new Set(seen).add(node);
  if (node.type === 'Identifier') {
    const binding = context.lookup(node);
    if (!binding && TEST_NAMES.has(node.name)) return true;
    if (binding?.kind === 'const') return testRoot(binding.init, context, next);
    return binding?.module === 'node:test';
  }
  return node.type === 'MemberExpression' && testRoot(node.object, context, next);
}

export function checkDisabledTest(node, context, add) {
  const assigned =
    node.type === 'AssignmentExpression'
      ? node.left
      : node.type === 'UpdateExpression' || (node.type === 'UnaryExpression' && node.operator === 'delete')
        ? node.argument
        : null;
  const assignedPath = globalPath(assigned, context)?.join('.');
  if (assignedPath === 'process.env.REQUIRE_NATIVE_ENGINE' || assignedPath === 'process.env')
    add(
      node.loc.start.line,
      'ERROR',
      'test-disabled',
      'Test code can overwrite the environment that forces native coverage.',
      'Keep REQUIRE_NATIVE_ENGINE under the full-gate runner control.',
    );
  if (
    node.type === 'AssignmentExpression' &&
    node.left.type === 'MemberExpression' &&
    TEST_MODIFIERS.has(propertyName(node.left, context))
  ) {
    const value = staticValue(node.right, context);
    if (value === UNKNOWN || value)
      add(
        node.loc.start.line,
        value === UNKNOWN ? 'REVIEW_REQUIRED' : 'ERROR',
        value === UNKNOWN ? 'conditional-test-skip' : 'test-disabled',
        'A test exclusion option is changed after its object is constructed.',
        'Keep coverage options immutable and execute all tests in the full gate.',
      );
  }
  if (
    node.type === 'MemberExpression' &&
    TEST_MODIFIERS.has(propertyName(node, context)) &&
    testRoot(node.object, context)
  )
    add(
      node.loc.start.line,
      'ERROR',
      'test-disabled',
      'A test modifier excludes required test coverage.',
      'Execute the test in the full gate; repair the implementation or test instead of skipping it.',
    );
  if (node.type !== 'Property') return;
  const name = propertyName(node, context);
  if (!['skip', 'todo', 'only'].includes(name)) return;
  const value = staticValue(node.value, context);
  if (value === UNKNOWN)
    add(
      node.loc.start.line,
      'REVIEW_REQUIRED',
      'conditional-test-skip',
      `Test option ${name} cannot be proven disabled with REQUIRE_NATIVE_ENGINE=1.`,
      'Remove the conditional exclusion or make the full-gate environment provably execute the test.',
    );
  else if (value)
    add(
      node.loc.start.line,
      'ERROR',
      'test-disabled',
      `Test option ${name} excludes coverage even in the full gate.`,
      'Remove the option and execute the test.',
    );
}
