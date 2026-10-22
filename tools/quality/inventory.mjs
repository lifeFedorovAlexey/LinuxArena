import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isStructureExcluded } from './structure.mjs';

function hasOwnGitRepository(root) {
  const result = spawnSync('git', ['rev-parse', '--show-prefix'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  // An index snapshot nested in a checkout must not inherit the parent's ignore rules.
  return !result.error && result.status === 0 && result.stdout.trim() === '';
}

function ignoredLocalSecret(root, name, ownRepository) {
  if (!/(^|\/)\.env(?:\.|$)/.test(name) || name.endsWith('.example')) return false;
  if (ownRepository) {
    const ignored = spawnSync('git', ['check-ignore', '--quiet', '--', name], {
      cwd: root,
      windowsHide: true,
    });
    if (!ignored.error && ignored.status === 0) return true;
  }
  // Never read a secret's values. A staged/forced addition must fail even in an isolated index snapshot.
  throw new Error(`Environment file is not ignored local data: ${name}`);
}

/** Include every owned file, even unknown extensions, so an undocumented addition cannot hide. */
export function readInventory(root) {
  return readDirectory(root, '', new Map(), hasOwnGitRepository(root));
}

function readDirectory(root, directory, files, ownRepository) {
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const name = directory ? `${directory}/${entry.name}` : entry.name;
    if (isStructureExcluded(name) || ignoredLocalSecret(root, name, ownRepository)) continue;
    if (entry.isSymbolicLink()) throw new Error(`Owned source cannot be a symbolic link: ${name}`);
    if (entry.isDirectory()) readDirectory(root, name, files, ownRepository);
    else if (entry.isFile()) {
      const bytes = readFileSync(join(root, name));
      files.set(name, bytes.includes(0) ? '' : bytes.toString('utf8'));
    }
  }
  return files;
}
