const directions = new Map([
  ['core/machine', ['core/machine']],
  ['core/visual', ['core/visual', 'core/machine']],
  ['core/placement', ['core/placement', 'core/visual', 'core/machine']],
  ['ui/shared', ['ui/shared', 'core/']],
  ['ui/editor', ['ui/editor', 'ui/shared', 'core/']],
  ['ui/contract', ['ui/contract', 'ui/shared', 'core/']],
  ['ui/scene', ['ui/scene', 'ui/shared', 'core/']],
  ['ui/shell', ['ui/', 'core/']],
  ['service/native', ['service/native']],
  ['service/store', ['service/store', 'service/native', 'core/']],
  ['service/http', ['service/http', 'service/store', 'core/']],
  ['service/mcp', ['service/mcp']],
]);

export function component(file) {
  if (!file.startsWith('src/')) return null;
  const parts = file.split('/');
  const owner = `${parts[1]}/${parts[2]}`;
  return parts.length >= 4 && directions.has(owner) ? owner : 'unknown';
}

export function checkComponent(file, add) {
  if (component(file) === 'unknown')
    add(
      1,
      'ERROR',
      'component-unknown',
      `No architecture policy owns source ${file}.`,
      'Place it in the responsible component or explicitly review and extend the dependency policy.',
    );
}

export function checkComponentDependency(file, target, line, add) {
  const from = component(file);
  if (from === null) return;
  const to = component(target);
  const allowed =
    to !== null &&
    to !== 'unknown' &&
    (directions.get(from) ?? []).some((entry) => (entry.endsWith('/') ? to.startsWith(entry) : to === entry));
  if (!allowed)
    add(
      line,
      'ERROR',
      'component-boundary',
      `${from} must not depend on ${to ?? 'tool'} (${target}).`,
      'Use the permitted component direction; move shared contracts downward instead of importing a higher owner.',
    );
}

export function checkServicePackage(file, specifier, nodeImport, line, add) {
  const owner = component(file);
  if (!owner?.startsWith('service/')) return;
  if (nodeImport) {
    const builtin = specifier.replace(/^node:/, '');
    if (['module', 'vm'].includes(builtin) || (builtin === 'child_process' && owner !== 'service/native'))
      add(
        line,
        'ERROR',
        'component-capability',
        `${owner} cannot acquire Node capability ${builtin}.`,
        'Keep process execution in service/native; the service does not need module-loader or VM authority.',
      );
    return;
  }
  if (owner === 'service/mcp' && /^@modelcontextprotocol\/sdk(?:\/|$)/.test(specifier)) return;
  add(
    line,
    'ERROR',
    'component-package',
    `${owner} has no permitted dependency on package ${specifier}.`,
    'Keep native/store/HTTP code dependency-free beyond Node/core; MCP may use its pinned SDK and local HTTP interface.',
  );
}
