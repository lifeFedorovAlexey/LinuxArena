import { builtinModules } from 'node:module';

export const UNKNOWN = Symbol('unknown');

export const NODE_MODULES = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));

export const NODE_GLOBALS = new Set([
  'process',
  'Buffer',
  'require',
  'module',
  'exports',
  '__dirname',
  '__filename',
  'setImmediate',
  'clearImmediate',
  'global',
]);

export const DOM_GLOBALS = new Set([
  'window',
  'document',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'HTMLElement',
  'Element',
  'Node',
  'Document',
  'MutationObserver',
  'ResizeObserver',
  'IntersectionObserver',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
  'customElements',
  'Worker',
  'SharedWorker',
  'WebSocket',
  'XMLHttpRequest',
  'Image',
  'Audio',
  'history',
  'screen',
  'addEventListener',
  'removeEventListener',
  'dispatchEvent',
  'self',
]);

export const HOST_EFFECTS = new Set([
  'fetch',
  'console',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
]);

export const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

export const CONTROLS = new Set([
  'IfStatement',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
  'SwitchStatement',
  'TryStatement',
  'ConditionalExpression',
]);

export const TEST_NAMES = new Set(['test', 'it', 'describe', 'suite']);

export const TEST_MODIFIERS = new Set(['skip', 'todo', 'only']);

export const JS_FILE = /\.(?:[cm]?js)$/i;

export const FIXTURE_FILE = /(?:^|\/)(?:__fixtures__|fixtures)(?:\/|$)/;

export const TEST_FILE = /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?js$/;

export const UI_PACKAGE = /^(?:blockly|three|react|react-dom|vue|svelte|@angular)(?:\/|$)/;
