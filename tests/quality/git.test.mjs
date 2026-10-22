import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInventory } from '../../tools/quality/inventory.mjs';

const project = resolve(fileURLToPath(new URL('../..', import.meta.url)));
test(
  'installed hook accepts valid snapshots and blocks staged code, unowned files and missing maps',
  { timeout: 180_000 },
  (t) => {
    const owned = join(project, '.quality');
    mkdirSync(owned, { recursive: true });
    const fixture = mkdtempSync(join(owned, 'git-proof-'));
    t.after(() => {
      assert.equal(dirname(fixture), owned);
      assert.ok(relative(owned, fixture).startsWith('git-proof-'));
      rmSync(fixture, { recursive: true, force: true });
    });
    const invoke = (command, args, cwd = fixture) =>
      spawnSync(command, args, {
        cwd,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 150_000,
        maxBuffer: 4 * 1024 * 1024,
      });
    const success = (result) => {
      assert.ifError(result.error);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      return result.stdout.trim();
    };
    const git = (...args) => success(invoke('git', args));
    // A pre-push source snapshot has no .git of its own. Use the same complete
    // source inventory as the gate rather than inheriting its parent checkout.
    for (const name of readInventory(project).keys()) {
      const source = join(project, name);
      const target = resolve(fixture, name);
      assert.ok(!relative(fixture, target).startsWith('..'));
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
    }
    git('init', '--quiet');
    success(invoke(process.execPath, ['tools/git/install.mjs']));
    assert.equal(git('config', '--get', 'core.hooksPath'), '.githooks');
    if (process.platform !== 'win32')
      for (const hook of ['pre-commit', 'pre-push'])
        assert.ok(statSync(join(fixture, '.githooks', hook)).mode & 0o111);
    git('add', '--', '.', ':(exclude)node_modules');
    // Create the dependency link after staging; Git rejects an ignored junction even in an exclusion.
    symlinkSync(
      join(project, 'node_modules'),
      join(fixture, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const identity = [
      '-c',
      'user.name=Quality Gate Fixture',
      '-c',
      'user.email=quality-test@example.invalid',
    ];
    git(...identity, 'commit', '--quiet', '-m', 'test: valid disposable quality fixture');
    const head = git('rev-parse', 'HEAD');
    const probe = 'tools/gate-probe.mjs';
    writeFileSync(join(fixture, probe), 'const neverUsed = 1;\n');
    git('add', probe);
    writeFileSync(join(fixture, probe), 'export const neverUsed = 1;\n');
    const rejected = invoke('git', [...identity, 'commit', '--quiet', '-m', 'test: must be rejected']);
    assert.notEqual(rejected.status, 0);
    assert.match(`${rejected.stdout}\n${rejected.stderr}`, /no-unused-vars/);
    assert.equal(git('rev-parse', 'HEAD'), head);
    assert.equal(git('show', `:${probe}`), 'const neverUsed = 1;');
    assert.equal(readFileSync(join(fixture, probe), 'utf8'), 'export const neverUsed = 1;\n');
    // A clean implementation still cannot enter the tree without an owning responsibility map.
    git('add', probe);
    const unowned = invoke('git', [...identity, 'commit', '--quiet', '-m', 'test: undocumented addition']);
    assert.notEqual(unowned.status, 0);
    assert.match(`${unowned.stdout}\n${unowned.stderr}`, /map-unowned/);
    assert.equal(git('rev-parse', 'HEAD'), head);
    git('rm', '--force', probe);
    git('rm', '--force', 'src/service/AGENTS.md');
    const missing = invoke('git', [...identity, 'commit', '--quiet', '-m', 'test: missing architecture map']);
    assert.notEqual(missing.status, 0);
    assert.match(`${missing.stdout}\n${missing.stderr}`, /map-missing/);
    assert.equal(git('rev-parse', 'HEAD'), head);
    assert.ok(existsSync(join(project, 'node_modules/eslint/package.json')));
  },
);
