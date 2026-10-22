import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  copyFileSync,
  lstatSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

function git(root, args, encoding = 'utf8') {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr.toString());
  return result.stdout;
}
function inside(directory, path) {
  const child = relative(directory, path);
  return child && !child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child);
}
/** Materialize Git objects, never overwrite/stash the user's working tree or index. */
export function createSnapshot(root, reference = null) {
  const entries = reference
    ? git(root, ['ls-tree', '-rz', reference])
    : git(root, ['ls-files', '--stage', '-z']);
  const base = join(root, '.quality');
  mkdirSync(base, { recursive: true });
  if (lstatSync(base).isSymbolicLink()) throw new Error('Snapshot directory must not be a symbolic link.');
  const directory = mkdtempSync(join(base, 'snapshot-'));
  try {
    for (const entry of entries.split('\0').filter(Boolean)) {
      const match = /^(\d+) (?:blob )?([a-f0-9]+)(?: (\d))?\t([\s\S]+)$/.exec(entry);
      if (!match || !['100644', '100755'].includes(match[1]) || (match[3] && match[3] !== '0'))
        throw new Error(`Unsupported index entry or unresolved conflict: ${entry}`);
      const name = match[4];
      const target = resolve(directory, name);
      if (!inside(directory, target) || /(^|[/\\])(?:\.git|node_modules|\.quality)([/\\]|$)/.test(name))
        throw new Error(`Unsafe snapshot path: ${name}`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, git(root, ['cat-file', 'blob', match[2]], null));
    }
    return { directory, identity: entries };
  } catch (error) {
    removeSnapshot(root, directory);
    throw error;
  }
}
export function removeSnapshot(root, directory) {
  const base = resolve(root, '.quality');
  if (!inside(base, resolve(directory)) || !relative(base, directory).startsWith('snapshot-'))
    throw new Error('Refusing to remove a path outside the owned snapshot directory.');
  if (lstatSync(base).isSymbolicLink())
    throw new Error('Refusing to remove a snapshot through a symbolic link.');
  rmSync(directory, { recursive: true, force: true });
}
export function checkSnapshot(root, reference = null) {
  const snapshot = createSnapshot(root, reference);
  try {
    for (const name of ['package.json', 'package-lock.json']) {
      if (!existsSync(join(snapshot.directory, name)))
        throw new Error(`${name} must be included in the commit.`);
      if (!readFileSync(join(root, name)).equals(readFileSync(join(snapshot.directory, name))))
        throw new Error(
          `${name} differs from the checked revision. Install that revision's dependencies before retrying.`,
        );
    }
    symlinkSync(
      join(root, 'node_modules'),
      join(snapshot.directory, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const env = { ...process.env };
    // Git passes repository-local variables into hooks; child integration tests own other repositories.
    for (const key of git(root, ['rev-parse', '--local-env-vars']).trim().split('\n')) delete env[key];
    const result = spawnSync(
      process.execPath,
      [join(snapshot.directory, 'tools/quality/run.mjs'), ...(reference ? [] : ['--fast'])],
      { cwd: snapshot.directory, env, stdio: 'inherit', windowsHide: true },
    );
    const report = join(snapshot.directory, '.quality/report.json');
    if (existsSync(report))
      copyFileSync(
        report,
        join(root, '.quality', reference ? `push-${reference}.json` : 'pre-commit-report.json'),
      );
    if (result.error || result.status !== 0)
      throw new Error(
        result.error?.message ?? 'Quality Gate blocked this revision. See .quality/ for the report.',
      );
    if (!reference && snapshot.identity !== git(root, ['ls-files', '--stage', '-z']))
      throw new Error('The index changed during the check; run the commit again.');
  } finally {
    removeSnapshot(root, snapshot.directory);
  }
}
function main() {
  const root = git(process.cwd(), ['rev-parse', '--show-toplevel']).trim();
  const mode = process.argv[2];
  if (mode === 'staged') checkSnapshot(root);
  else if (mode === 'push') {
    const revisions = new Set();
    for (const line of readFileSync(0, 'utf8').trim().split('\n').filter(Boolean)) {
      const fields = line.trim().split(/\s+/);
      if (fields.length !== 4 || !/^[a-f0-9]{40,64}$/.test(fields[1]))
        throw new Error('Invalid pre-push revision input.');
      if (!/^0+$/.test(fields[1])) revisions.add(fields[1]);
    }
    for (const revision of revisions) checkSnapshot(root, revision);
  } else throw new Error('Usage: node tools/git/hooks.mjs staged|push');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
