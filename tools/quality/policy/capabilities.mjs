import { NODE_GLOBALS, DOM_GLOBALS, HOST_EFFECTS } from './constants.mjs';
import { layer } from './imports.mjs';
import { globalPath } from './values.mjs';
import { isReference } from './scopes.mjs';

export function checkHostAccess(file, node, parent, key, context, add) {
  if (node.type === 'Identifier' && !isReference(node, parent, key, context)) return;
  if (node.type !== 'Identifier' && node.type !== 'MemberExpression') return;
  let path = globalPath(node, context);
  if (!path) {
    if (node.type === 'MemberExpression' && globalPath(node.object, context)?.[0] === 'globalThis')
      add(
        node.loc.start.line,
        'REVIEW_REQUIRED',
        'dynamic-global-access',
        'Computed global access hides which host capability is used.',
        'Use an explicit capability or review the exact access and all possible keys.',
      );
    return;
  }
  while (['globalThis', 'global', 'window', 'self'].includes(path[0]) && path.length > 1)
    path = path.slice(1);
  if (['eval', 'Function'].includes(path[0]))
    add(
      node.loc.start.line,
      'ERROR',
      'dynamic-code',
      `Dynamic code capability ${path[0]} is referenced.`,
      'Replace runtime code generation with explicit data and functions.',
    );
  const origin = layer(file);
  if (
    origin === 'core' &&
    (NODE_GLOBALS.has(path[0]) || DOM_GLOBALS.has(path[0]) || HOST_EFFECTS.has(path[0]))
  )
    add(
      node.loc.start.line,
      'ERROR',
      'core-host-access',
      `Pure core reads host capability ${path[0]}.`,
      'Pass required values or a pure interface explicitly from the outer layer.',
    );
  if (origin === 'ui' && NODE_GLOBALS.has(path[0]))
    add(
      node.loc.start.line,
      'ERROR',
      'ui-node-access',
      `Browser UI accesses Node capability ${path[0]}.`,
      'Move the operation to the service or a Node script.',
    );
  if (origin === 'service' && DOM_GLOBALS.has(path[0]))
    add(
      node.loc.start.line,
      'ERROR',
      'service-dom-access',
      `Service accesses browser capability ${path[0]}.`,
      'Keep browser work in the UI and communicate through the service interface.',
    );
}
