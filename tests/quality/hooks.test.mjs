import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createSnapshot, removeSnapshot, checkSnapshot } from '../../tools/git/hooks.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'linuxarena-hook-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '--quiet');
  return { root, git };
}
test('repository attributes keep checkout and snapshot bytes equal with either autocrlf setting', (t) => {
  for (const autocrlf of ['true', 'false']) {
    const { root, git } = fixture(t);
    git('config', 'core.autocrlf', autocrlf);
    writeFileSync(
      join(root, '.gitattributes'),
      readFileSync(new URL('../../.gitattributes', import.meta.url)),
    );
    const files = new Map([
      ['package.json', '{}\n'],
      ['package-lock.json', '{}\n'],
      ['README.md', '# Fixture\n'],
      ['workflow.yml', 'name: fixture\n'],
      ['config.yaml', 'name: fixture\n'],
      ['Cargo.toml', '[package]\n'],
      ['.githooks/pre-commit', '#!/bin/sh\nexit 0\n'],
      ['reference/linux/probe.S', 'preserve upstream\r\nbytes\r\n'],
      ['probe.bin', new Uint8Array([0, 13, 10, 255, 10])],
    ]);
    for (const [name, bytes] of files) {
      mkdirSync(dirname(join(root, name)), { recursive: true });
      writeFileSync(join(root, name), bytes);
    }
    git('add', '.');
    for (const name of files.keys()) rmSync(join(root, name));
    git('checkout-index', '--all');
    const { directory } = createSnapshot(root);
    try {
      for (const [name, bytes] of files) {
        const expected = Buffer.from(bytes);
        assert.deepEqual(readFileSync(join(root, name)), expected, name + ' checkout, autocrlf=' + autocrlf);
        assert.deepEqual(
          readFileSync(join(directory, name)),
          expected,
          name + ' snapshot, autocrlf=' + autocrlf,
        );
      }
    } finally {
      removeSnapshot(root, directory);
    }
  }
});

test('pre-commit snapshot reads staged bytes, including partially staged and deleted files', (t) => {
  const { root, git } = fixture(t);
  writeFileSync(join(root, 'sample.mjs'), 'const staged = true;\n');
  git('add', 'sample.mjs');
  writeFileSync(join(root, 'sample.mjs'), 'const working = false;\n');
  writeFileSync(join(root, 'untracked.mjs'), 'untracked');
  const { directory } = createSnapshot(root);
  assert.equal(readFileSync(join(directory, 'sample.mjs'), 'utf8'), 'const staged = true;\n');
  assert.equal(existsSync(join(directory, 'untracked.mjs')), false);
  removeSnapshot(root, directory);
  assert.equal(readFileSync(join(root, 'sample.mjs'), 'utf8'), 'const working = false;\n');
  git('rm', '--cached', '--force', '--quiet', 'sample.mjs');
  const removed = createSnapshot(root);
  assert.equal(existsSync(join(removed.directory, 'sample.mjs')), false);
  removeSnapshot(root, removed.directory);
});
test('a failing checker blocks a real snapshot and cleans up without changing the index', (t) => {
  const { root, git } = fixture(t);
  mkdirSync(join(root, 'tools/quality'), { recursive: true });
  mkdirSync(join(root, 'node_modules'));
  for (const name of ['package.json', 'package-lock.json']) writeFileSync(join(root, name), '{}\n');
  // Isolate process failure propagation; the policy tests inject actual violations separately.
  writeFileSync(join(root, 'tools/quality/run.mjs'), 'process.exitCode = 7;\n');
  git('add', '.');
  const before = git('ls-files', '--stage');
  assert.throws(() => checkSnapshot(root), /blocked/);
  assert.equal(git('ls-files', '--stage'), before);
  assert.ok(existsSync(join(root, 'node_modules')));
});
test('snapshot deletion rejects paths outside its owned directory', (t) => {
  const { root } = fixture(t);
  assert.throws(() => removeSnapshot(root, root), /Refusing/);
  assert.ok(existsSync(root));
});
