export function children(node) {
  const result = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc') continue;
    if (Array.isArray(value)) {
      for (const child of value) if (child?.type) result.push([child, key]);
    } else if (value?.type) result.push([value, key]);
  }
  return result;
}

export function walk(node, visit, parent = null, key = null) {
  visit(node, parent, key);
  for (const [child, childKey] of children(node)) walk(child, visit, node, childKey);
}
