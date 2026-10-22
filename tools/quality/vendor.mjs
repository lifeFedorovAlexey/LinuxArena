const manifestPath = 'reference/manifest.json';
const prefix = 'reference/linux/';

/** Only manifest-owned bytes may use the pinned vendor subtree exemption. */
export function checkVendorInventory(files, add) {
  const actual = [...files.keys()].filter((file) => file.startsWith(prefix));
  if (!actual.length && !files.has(manifestPath)) return;
  let manifest;
  try {
    manifest = JSON.parse(files.get(manifestPath));
    if (!Array.isArray(manifest?.files)) throw new Error('Manifest files must be an array.');
  } catch {
    add(
      manifestPath,
      1,
      'ERROR',
      'vendor-manifest',
      'Pinned vendor files require a valid files manifest.',
      'Restore the manifest before applying any exemption to reference/linux.',
    );
    return;
  }
  const declared = new Set();
  for (const entry of manifest.files) {
    const path = entry?.path;
    if (
      typeof path !== 'string' ||
      !path.startsWith('linux/') ||
      /[\\\0?#]/.test(path) ||
      path.split('/').some((part) => !part || part === '.' || part === '..') ||
      !['original', 'excerpt'].includes(entry.kind) ||
      !/^[a-f\d]{64}$/i.test(entry.sha256 ?? '')
    ) {
      add(
        manifestPath,
        1,
        'ERROR',
        'vendor-manifest',
        'Vendor entry has an invalid path, provenance kind or SHA-256.',
        'Describe each preserved original/excerpt with its safe relative path and exact hash.',
      );
      continue;
    }
    const target = `reference/${path}`;
    if (declared.has(target) || !files.has(target))
      add(
        manifestPath,
        1,
        'ERROR',
        'vendor-manifest',
        `Vendor entry ${path} is duplicate or missing from inventory.`,
        'Keep one manifest entry per actual preserved file.',
      );
    declared.add(target);
  }
  for (const path of actual) {
    if (!declared.has(path))
      add(
        path,
        1,
        'ERROR',
        'vendor-unowned',
        'A file inside the vendor exemption is absent from the manifest.',
        'Keep first-party code outside reference/linux; explicitly document any new preserved upstream bytes.',
      );
  }
}
