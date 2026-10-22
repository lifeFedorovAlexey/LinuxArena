import { parse } from 'acorn';
import { FUNCTIONS, JS_FILE, TEST_FILE, FIXTURE_FILE } from './constants.mjs';
import { walk } from './ast.mjs';
import { createScopes } from './scopes.mjs';
import { propertyName, globalPath } from './values.mjs';
import { normalizePath, checkImport, inspectGraph } from './imports.mjs';
import { checkHostAccess } from './capabilities.mjs';
import { checkDisabledTest } from './test-policy.mjs';
import { reviewFunctions } from './metrics.mjs';
import { addTextFindings, checkComments } from './text.mjs';
import { checkComponent } from './components.mjs';

export function inspectAst(file, ast, context, files, edges, add) {
  const testFile = TEST_FILE.test(file) && !FIXTURE_FILE.test(file);
  walk(ast, (node, parent, key) => {
    if (
      ['ImportDeclaration', 'ExportAllDeclaration', 'ExportNamedDeclaration'].includes(node.type) &&
      node.source
    )
      checkImport(file, node, node.source.value, files, edges, add);
    if (node.type === 'ImportExpression')
      checkImport(file, node, node.source.type === 'Literal' ? node.source.value : null, files, edges, add);
    if (node.type === 'CallExpression' && globalPath(node.callee, context)?.join('.') === 'require')
      checkImport(
        file,
        node,
        node.arguments[0]?.type === 'Literal' ? node.arguments[0].value : null,
        files,
        edges,
        add,
      );
    checkHostAccess(file, node, parent, key, context, add);
    if (testFile) checkDisabledTest(node, context, add);
    if (
      node.type === 'MemberExpression' &&
      propertyName(node, context) === 'constructor' &&
      (FUNCTIONS.has(node.object.type) ||
        (node.object.type === 'MemberExpression' && propertyName(node.object, context) === 'constructor'))
    )
      add(
        node.loc.start.line,
        'ERROR',
        'dynamic-code',
        'A constructor reference recovers runtime code generation.',
        'Use explicit data and functions instead of recovering the Function constructor.',
      );
    if (
      ['CallExpression', 'NewExpression'].includes(node.type) &&
      node.callee.type === 'MemberExpression' &&
      propertyName(node.callee, context) === 'constructor'
    ) {
      const certain =
        FUNCTIONS.has(node.callee.object.type) ||
        (node.callee.object.type === 'MemberExpression' &&
          propertyName(node.callee.object, context) === 'constructor');
      add(
        node.loc.start.line,
        certain ? 'ERROR' : 'REVIEW_REQUIRED',
        'dynamic-code',
        'Calling an indirect constructor can recover runtime code generation.',
        'Use the explicit intended constructor; otherwise review and prove the callable value.',
      );
    }
  });
}

export function analyzeSources(inputFiles) {
  if (!(inputFiles instanceof Map))
    throw new TypeError('analyzeSources requires Map<repository-relative path, source text>.');
  const files = new Map();
  for (const [file, source] of inputFiles) {
    if (typeof file !== 'string' || typeof source !== 'string')
      throw new TypeError('Source paths and contents must be strings.');
    const normalized = normalizePath(file);
    if (/^(?:\/|[a-z]:|\.\.(?:\/|$))/i.test(normalized) || files.has(normalized))
      throw new TypeError('Source paths must be unique repository-relative paths.');
    files.set(normalized, source);
  }
  const findings = [];
  const edges = [];
  const duplicates = new Map();
  const addFor = (file) => (line, severity, rule, reason, fix) =>
    findings.push({ file, line, severity, rule, reason, fix });
  for (const [file, source] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    if (file.startsWith('reference/')) continue;
    const add = addFor(file);
    addTextFindings(source, add);
    if (!JS_FILE.test(file)) continue;
    checkComponent(file, add);
    const comments = [];
    let ast;
    try {
      ast = parse(source, {
        ecmaVersion: 'latest',
        sourceType: file.endsWith('.cjs') ? 'script' : 'module',
        locations: true,
        onComment: comments,
        allowHashBang: true,
      });
    } catch (error) {
      add(
        error.loc?.line ?? 1,
        'ERROR',
        'syntax-error',
        error.message,
        'Correct the JavaScript syntax before running the gate.',
      );
      continue;
    }
    checkComments(comments, FIXTURE_FILE.test(file), add);
    inspectAst(file, ast, createScopes(ast), files, edges, add);
    reviewFunctions(file, ast, duplicates, add);
  }
  inspectGraph(edges, addFor);
  const unique = new Map(findings.map((finding) => [JSON.stringify(finding), finding]));
  return [...unique.values()].sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule),
  );
}
