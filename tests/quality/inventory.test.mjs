import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { readInventory } from '../../tools/quality/inventory.mjs';
import { spawnSync } from 'node:child_process';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'linuxarena-inventory-'));
  t.after(() => {
    assert.equal(dirname(root), resolve(tmpdir()));
    rmSync(root, { recursive: true, force: true });
  });
  const put = (name, contents) => {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  };
  return { root, put };
}

test('inventory retains unknown extensions, extensionless configuration and binary ownership', (t) => {
  const { root, put } = fixture(t);
  put('src/new-owner/note.unusual', 'new file');
  put('.github/CODEOWNERS', '* @owner\n');
  put('assets/icon.bin', Buffer.from([0, 3, 5]));
  const inventory = readInventory(root);
  assert.deepEqual([...inventory.keys()].sort(), [
    '.github/CODEOWNERS',
    'assets/icon.bin',
    'src/new-owner/note.unusual',
  ]);
  assert.equal(inventory.get('assets/icon.bin'), '');
});

test('local/generated trees are excluded while documented environment examples remain owned', (t) => {
  const { root, put } = fixture(t);
  const init = spawnSync('git', ['init', '--quiet'], { cwd: root, windowsHide: true });
  assert.equal(init.status, 0);
  put('.gitignore', '.env\n.env.*\n!.env.example\n');
  for (const directory of [
    '.git',
    'node_modules',
    'dist',
    '.arena',
    '.quality',
    'artifacts',
    'engine/target',
  ])
    put(`${directory}/nested/ignored.mjs`, 'invalid syntax');
  put('.env', 'local secret');
  put('.env.development', 'local secret');
  put('.env.example', 'TOKEN=\n');
  put('src/main.mjs', 'export const value = 1;\n');
  assert.deepEqual([...readInventory(root).keys()].sort(), ['.env.example', '.gitignore', 'src/main.mjs']);
});

test('force-staged environment paths cannot bypass ownership or expose their contents', (t) => {
  const { root, put } = fixture(t);
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: root, windowsHide: true }).status, 0);
  put('.gitignore', '.env.*\n');
  put('.env.extra.custom', 'sensitive content must not enter diagnostics');
  assert.equal(
    spawnSync('git', ['add', '--force', '.env.extra.custom'], { cwd: root, windowsHide: true }).status,
    0,
  );
  assert.throws(
    () => readInventory(root),
    /^Error: Environment file is not ignored local data: \.env\.extra\.custom$/,
  );
});

test('a repository-free snapshot fails closed on environment-shaped additions', (t) => {
  const { root, put } = fixture(t);
  put('.env.extra.custom', 'secret');
  assert.throws(() => readInventory(root), /not ignored local data: \.env\.extra\.custom/);
});

test('a snapshot cannot inherit its parent checkout ignore rules', (t) => {
  const { root, put } = fixture(t);
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: root, windowsHide: true }).status, 0);
  put('.gitignore', '.quality/\n');
  put('.quality/snapshot-proof/.env.hidden-source', 'secret');
  assert.throws(() => readInventory(join(root, '.quality/snapshot-proof')), /not ignored local data/);
});

test('inventory refuses to follow a first-party directory link', (t) => {
  const { root, put } = fixture(t);
  put('.quality/local-target/not-source.mjs', 'local state');
  symlinkSync(
    join(root, '.quality/local-target'),
    join(root, 'linked-source'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  assert.throws(() => readInventory(root), /symbolic link: linked-source/);
});
