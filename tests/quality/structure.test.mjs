import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStructure, isStructureExcluded } from '../../tools/quality/structure.mjs';

const row = (path, responsibility = 'Own this concrete component.') =>
  `| [${path}](${path}) | ${responsibility} |`;
const map = (rows = [], purpose = 'Локальная ответственность.') =>
  [
    '# Архитектура',
    '## Назначение',
    purpose,
    '## Границы',
    'Не получает ответственность соседних компонентов.',
    '## Зависимости',
    'Только явно описанные зависимости.',
    '## Карта',
    '| Путь | Ответственность |',
    '| --- | --- |',
    ...rows,
    '',
  ].join('\n');
const analyze = (files) => analyzeStructure(new Map(Object.entries(files)));
const rootWith = (name, text) => ({ 'AGENTS.md': map([row(name)]), [name]: text });
const has = (findings, rule, severity = 'ERROR') => {
  const match = findings.find((finding) => finding.rule === rule && finding.severity === severity);
  assert.ok(match, `Expected ${severity} ${rule}: ${JSON.stringify(findings)}`);
  assert.ok(match.file && match.line > 0 && match.reason && match.fix);
};

test('complete local maps own immediate files and child maps, including hidden configuration', () => {
  const files = {
    'AGENTS.md': map([row('README.md'), row('src/AGENTS.md'), row('.github/AGENTS.md')]),
    'README.md': '# Project\n',
    'src/AGENTS.md': map([row('math.mjs')]),
    'src/math.mjs': 'export const value = 1;\n',
    '.github/AGENTS.md': map([row('workflows/AGENTS.md')]),
    '.github/workflows/AGENTS.md': map([row('check.yml')]),
    '.github/workflows/check.yml': 'name: Check\n',
  };
  assert.deepEqual(analyze(files), []);
});

test('a missing map fails for root and every first-party child directory', () => {
  has(analyze({ 'README.md': '' }), 'map-missing');
  const findings = analyze({ 'AGENTS.md': map([row('src/AGENTS.md')]), 'src/example.mjs': '' });
  has(findings, 'map-missing');
  assert.ok(findings.some((item) => item.file === 'src/AGENTS.md'));
});

test('unowned additions are detected for arbitrary file extensions and new child folders', () => {
  has(analyze({ 'AGENTS.md': map(), 'new.custom-format': 'opaque' }), 'map-unowned');
  const findings = analyze({ 'AGENTS.md': map(), 'new-folder/feature.mjs': '' });
  has(findings, 'map-unowned');
  has(findings, 'map-missing');
});

test('stale, duplicate and parent-escaping ownership links fail', () => {
  has(analyze({ 'AGENTS.md': map([row('deleted.mjs')]) }), 'map-stale');
  has(analyze({ 'AGENTS.md': map([row('a.mjs'), row('./a.mjs')]), 'a.mjs': '' }), 'map-duplicate');
  for (const path of [
    '../outside.mjs',
    '%2e%2e/outside.mjs',
    '/absolute.mjs',
    'https://host/file',
    'file:///file',
    '..%5coutside.mjs',
  ])
    has(analyze({ 'AGENTS.md': map([row(path)]) }), 'map-link');
});

test('a parent map cannot replace a child map with a link to a grandchild file', () => {
  const findings = analyze({
    'AGENTS.md': map([row('src/logic.mjs')]),
    'src/AGENTS.md': map([row('logic.mjs')]),
    'src/logic.mjs': '',
  });
  has(findings, 'map-stale');
  has(findings, 'map-unowned');
});

test('every ownership row requires an actual relative link and a nonempty responsibility', () => {
  has(analyze({ 'AGENTS.md': map(['| code.mjs | Code |']), 'code.mjs': '' }), 'map-link');
  has(analyze({ 'AGENTS.md': map([row('code.mjs', ' ** ** ')]), 'code.mjs': '' }), 'map-responsibility');
  has(
    analyze({ 'AGENTS.md': map(['| [code.mjs](code.mjs) | Code | Extra |']), 'code.mjs': '' }),
    'map-table',
  );
});

test('required sections and the exact responsibility table header cannot be omitted or hidden in a fence', () => {
  has(analyze({ 'AGENTS.md': '## Карта\n| Путь | Ответственность |\n| --- | --- |\n' }), 'map-section');
  has(analyze({ 'AGENTS.md': map().replace('| Путь | Ответственность |', '| Name | Role |') }), 'map-table');
  has(analyze({ 'AGENTS.md': `\`\`\`md\n${map()}\`\`\`\n` }), 'map-section');
  has(analyze({ 'AGENTS.md': map() + '\n## Границы\nDuplicate.\n' }), 'map-section');
});

test('map context budget is independently enforced by physical lines and characters', () => {
  has(analyze({ 'AGENTS.md': map() + '\n'.repeat(81) }), 'map-budget');
  has(analyze({ 'AGENTS.md': map([], 'x'.repeat(6001)) }), 'map-budget');
});

test('ownership rows in comments, mismatched fences and indented code cannot satisfy the map', () => {
  const ownership = row('owned.mjs');
  for (const hidden of [
    `<!--\n${ownership}\n-->`,
    `<!-- ${ownership} -->`,
    `\`\`\`\`md\n\`\`\`\n${ownership}\n\`\`\`\``,
    `    ${ownership}`,
  ])
    has(analyze({ 'AGENTS.md': map([hidden]), 'owned.mjs': '' }), 'map-unowned');
  const commentInCode = `\`\`\`md\n<!-- literal code\n\`\`\`\n${ownership}`;
  assert.deepEqual(analyze({ 'AGENTS.md': map([commentInCode]), 'owned.mjs': '' }), []);
});

test('source files require review above 400 and cannot exceed 600 physical lines', () => {
  for (const extension of ['mjs', 'js', 'cjs', 'css', 'rs']) {
    assert.deepEqual(analyze(rootWith(`code.${extension}`, 'line\n'.repeat(400))), []);
    has(analyze(rootWith(`code.${extension}`, 'line\n'.repeat(401))), 'file-size', 'REVIEW_REQUIRED');
    has(analyze(rootWith(`code.${extension}`, 'line\n'.repeat(600))), 'file-size', 'REVIEW_REQUIRED');
    has(analyze(rootWith(`code.${extension}`, 'line\n'.repeat(601))), 'file-size');
  }
});

test('test files have a distinct hard 700-line budget and lockfiles are exempt from source size', () => {
  const files = {
    'AGENTS.md': map([row('tests/AGENTS.md'), row('package-lock.json')]),
    'tests/AGENTS.md': map([row('case.test.mjs')]),
    'tests/case.test.mjs': 'line\r\n'.repeat(700),
    'package-lock.json': '\n'.repeat(10000),
  };
  assert.deepEqual(analyze(files), []);
  files['tests/case.test.mjs'] += 'line\n';
  has(analyze(files), 'file-size');
});

test('directory clutter rejects thirteen direct files despite complete ownership documentation', () => {
  const names = Array.from({ length: 13 }, (_, index) => `item-${index}.mjs`);
  const files = {
    'AGENTS.md': map([row('component/AGENTS.md')]),
    'component/AGENTS.md': map(names.map((name) => row(name))),
  };
  for (const name of names) files[`component/${name}`] = '';
  has(analyze(files), 'directory-clutter');
  delete files['component/item-12.mjs'];
  files['component/AGENTS.md'] = map(names.slice(0, 12).map((name) => row(name)));
  assert.deepEqual(analyze(files), []);
});

test('root allows 24 direct files but no directory may accumulate more than 12 children', () => {
  const names = Array.from({ length: 24 }, (_, index) => `file-${index}.json`);
  const files = { 'AGENTS.md': map(names.map((name) => row(name))) };
  for (const name of names) files[name] = '{}';
  assert.deepEqual(analyze(files), []);
  files.extra = '';
  has(analyze(files), 'directory-clutter');
  const children = Array.from({ length: 13 }, (_, index) => `part-${index}/AGENTS.md`);
  const tree = { 'AGENTS.md': map(children.map((name) => row(name))) };
  for (const name of children) tree[name] = map();
  has(analyze(tree), 'directory-clutter');
});

test('only generated roots are excluded; ordinary nested directories still require maps', () => {
  const files = { 'AGENTS.md': map() };
  for (const root of ['.git', 'node_modules', 'dist', '.arena', '.quality', 'artifacts', 'engine/target']) {
    files[`${root}/deep/generated.mjs`] = 'line\n'.repeat(1000);
    assert.equal(isStructureExcluded(`${root}/deep/generated.mjs`), true);
  }
  assert.deepEqual(analyze(files), []);
  assert.equal(isStructureExcluded('src/dist/file.mjs'), false);
  files['src/dist/file.mjs'] = '';
  has(analyze(files), 'map-missing');
});

test('pinned Linux is a delegated manifest-backed boundary without injected vendor maps', () => {
  const files = {
    'AGENTS.md': map([row('reference/AGENTS.md')]),
    'reference/AGENTS.md': map([
      row('manifest.json', 'Exact upstream hashes.'),
      row('linux/', 'Pinned upstream bytes; rationale and hashes in manifest.json.'),
    ]),
    'reference/manifest.json': JSON.stringify({
      files: [{ path: 'linux/arch/deep/copied.rs', kind: 'original', sha256: 'a'.repeat(64) }],
    }),
    'reference/linux/arch/deep/copied.rs': 'line\n'.repeat(9000),
  };
  assert.deepEqual(analyze(files), []);
  files['reference/AGENTS.md'] = map([row('manifest.json'), row('linux/')]);
  has(analyze(files), 'vendor-boundary');
  delete files['reference/manifest.json'];
  has(analyze(files), 'vendor-boundary');
});

test('vendor exemption requires exact manifest membership and rejects malformed or stale entries', () => {
  const path = 'linux/arch/original.S';
  const entry = { path, kind: 'original', sha256: 'a'.repeat(64) };
  const files = {
    'AGENTS.md': map([row('reference/AGENTS.md')]),
    'reference/AGENTS.md': map([
      row('manifest.json'),
      row('linux/', 'Pinned upstream bytes; manifest.json records provenance.'),
    ]),
    'reference/manifest.json': JSON.stringify({ files: [entry] }),
    [`reference/${path}`]: 'source',
  };
  assert.deepEqual(analyze(files), []);
  files['reference/linux/extra.mjs'] = 'eval(code);\n'.repeat(1000);
  has(analyze(files), 'vendor-unowned');
  delete files['reference/linux/extra.mjs'];
  for (const entries of [
    [entry, entry],
    [{ ...entry, path: 'linux/../escape' }],
    [{ ...entry, path: 'linux/missing.S' }],
    [{ ...entry, sha256: 'missing' }],
  ]) {
    files['reference/manifest.json'] = JSON.stringify({ files: entries });
    has(analyze(files), 'vendor-manifest');
  }
  files['reference/manifest.json'] = '{';
  has(analyze(files), 'vendor-manifest');
});

test('analysis is deterministic, normalizes Windows separators and never mutates the inventory', () => {
  const input = new Map([
    ['AGENTS.md', map([row('src/AGENTS.md')])],
    ['src\\AGENTS.md', map()],
  ]);
  const before = [...input];
  assert.deepEqual(analyzeStructure(input), []);
  assert.deepEqual(analyzeStructure(input), analyzeStructure(input));
  assert.deepEqual([...input], before);
  assert.throws(() => analyzeStructure({}), TypeError);
  for (const path of ['../escape', '/absolute', 'D:\\absolute', '.'])
    assert.throws(() => analyzeStructure(new Map([[path, '']])), TypeError);
  assert.throws(
    () =>
      analyzeStructure(
        new Map([
          ['a.mjs', ''],
          ['./a.mjs', ''],
        ]),
      ),
    TypeError,
  );
  assert.throws(() => analyzeStructure(new Map([['a.mjs', null]])), TypeError);
});
