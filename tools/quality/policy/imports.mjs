import { posix } from 'node:path';
import { NODE_MODULES, UI_PACKAGE } from './constants.mjs';
import { checkComponentDependency, checkServicePackage } from './components.mjs';

export function normalizePath(file) {
  return posix.normalize(file.replaceAll('\\', '/')).replace(/^\.\//, '');
}

export function layer(file) {
  if (file.startsWith('src/core/')) return 'core';
  if (file.startsWith('src/service/')) return 'service';
  return file.startsWith('src/') ? 'ui' : 'tool';
}

export function localTarget(file, specifier, files) {
  let decoded;
  try {
    decoded = decodeURIComponent(specifier.replace(/[?#].*$/, ''));
  } catch {
    return null;
  }
  const target = normalizePath(posix.join(posix.dirname(file), decoded));
  return (
    [
      target,
      `${target}.mjs`,
      `${target}.js`,
      `${target}.cjs`,
      `${target}/index.mjs`,
      `${target}/index.js`,
    ].find((candidate) => files.has(candidate)) ?? target
  );
}

export function checkImport(file, node, specifier, files, edges, add) {
  const origin = layer(file);
  if (typeof specifier !== 'string') {
    add(
      node.loc.start.line,
      'ERROR',
      'dynamic-import',
      'The dependency cannot be resolved from a literal module name.',
      'Use a literal import so architecture checks can inspect the dependency.',
    );
    return;
  }
  if (specifier.startsWith('.')) {
    const target = localTarget(file, specifier, files);
    if (!target || !files.has(target)) {
      add(
        node.loc.start.line,
        'ERROR',
        'import-boundary',
        `Local dependency ${specifier} is missing from the source inventory.`,
        'Include the dependency in the checked source inventory and correct the import path.',
      );
      return;
    }
    edges.push({ source: file, target, line: node.loc.start.line });
    checkComponentDependency(file, target, node.loc.start.line, add);
    const allowed =
      origin === 'tool' ||
      origin === layer(target) ||
      ((origin === 'ui' || origin === 'service') && layer(target) === 'core');
    if (!allowed)
      add(
        node.loc.start.line,
        'ERROR',
        'import-boundary',
        `${origin} source depends on ${layer(target)} source ${target}.`,
        'Move the dependency behind the permitted layer boundary or inject a pure interface.',
      );
    return;
  }
  const nodeImport = specifier.startsWith('node:') || NODE_MODULES.has(specifier);
  checkServicePackage(file, specifier, nodeImport, node.loc.start.line, add);
  if (
    ((origin === 'core' || origin === 'ui') && nodeImport) ||
    ((origin === 'core' || origin === 'service') && UI_PACKAGE.test(specifier)) ||
    ((origin === 'core' || origin === 'ui' || origin === 'service') &&
      /^(?:[/\\]|[a-z]+:)/i.test(specifier) &&
      !nodeImport)
  ) {
    add(
      node.loc.start.line,
      'ERROR',
      'import-boundary',
      `${origin} source imports prohibited host/UI dependency ${specifier}.`,
      'Keep host, browser and service dependencies in their owning layers.',
    );
  } else if (origin === 'core') {
    add(
      node.loc.start.line,
      'REVIEW_REQUIRED',
      'opaque-core-dependency',
      `Purity of external core dependency ${specifier} is not established.`,
      'Review its runtime dependency graph and pin evidence to the exact source bytes.',
    );
  }
}

export function inspectGraph(edges, addFor) {
  const outgoing = new Map();
  for (const edge of edges) {
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    outgoing.get(edge.source).push(edge);
  }
  const visited = new Set();
  const active = new Map();
  function visit(file, path) {
    if (visited.has(file)) return;
    active.set(file, path.length);
    for (const edge of outgoing.get(file) ?? []) {
      if (active.has(edge.target))
        addFor(file)(
          edge.line,
          'ERROR',
          'import-cycle',
          `Local import cycle: ${[...path.slice(active.get(edge.target)), file, edge.target].join(' → ')}.`,
          'Break the cycle by moving shared pure definitions into a lower-level module.',
        );
      else visit(edge.target, [...path, file]);
    }
    active.delete(file);
    visited.add(file);
  }
  for (const file of [...outgoing.keys()].sort()) visit(file, []);
  const genericFiles = [...outgoing.keys()]
    .filter((file) => /^src\/core\/(?:machine|visual)\//.test(file))
    .sort();
  for (const file of genericFiles) {
    const pending = [...(outgoing.get(file) ?? [])].map((edge) => ({ ...edge, first: edge }));
    const seen = new Set();
    for (let index = 0; index < pending.length; index += 1) {
      const edge = pending[index];
      if (seen.has(edge.target)) continue;
      seen.add(edge.target);
      if (edge.target.startsWith('src/core/placement/'))
        addFor(file)(
          edge.first.line,
          'ERROR',
          'generic-boundary',
          `Generic module depends on Linux-specific ${edge.target}, directly or through an intermediary.`,
          'Inject algorithm bindings through the adapter argument; keep the generic module independent.',
        );
      for (const next of outgoing.get(edge.target) ?? []) pending.push({ ...next, first: edge.first });
    }
  }
}
