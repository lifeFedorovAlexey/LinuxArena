import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeSources } from './policy/index.mjs';
import { analyzeStructure } from './structure.mjs';
import { readInventory } from './inventory.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const fast = process.argv.includes('--fast');
const report = {
  scope: fast ? 'pre-commit' : 'full',
  timestamp: new Date().toISOString(),
  statuses: {
    ARCHITECTURE: 'REVIEW REQUIRED',
    'STATIC ANALYSIS': 'FAIL',
    STYLE: 'FAIL',
    SECURITY: 'REVIEW REQUIRED',
    TESTS: 'NOT RUN',
    REGRESSION: 'NOT RUN',
    'QUALITY GATE': 'BLOCKED',
  },
  stages: [],
  findings: [],
};
function stage(name, executable, args) {
  console.log(`\n[${name}]`);
  const result = spawnSync(executable, args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    timeout: 300_000,
    env: { ...process.env, REQUIRE_NATIVE_ENGINE: '1' },
  });
  const passed = !result.error && result.status === 0;
  report.stages.push({
    name,
    status: passed ? 'PASS' : 'FAIL',
    exitCode: result.status,
    error: result.error?.message,
  });
  if (result.error) console.error(result.error.message);
  return passed;
}
const node = (name, script, args = []) => stage(name, process.execPath, [script, ...args]);
function npmCli() {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
  ];
  const cli = candidates.find((path) => path && path.endsWith('.js') && existsSync(path));
  if (!cli) throw new Error('npm CLI not found. Run npm run quality.');
  return cli;
}
function reviewFindings(files, findings) {
  const reviews = JSON.parse(files.get('tools/quality/reviews.json') ?? '{"reviews":[]}').reviews;
  return findings.map((finding) => {
    if (finding.severity !== 'REVIEW_REQUIRED') return finding;
    const digest = createHash('sha256').update(files.get(finding.file)).digest('hex');
    const review = reviews.find(
      (item) =>
        item.file === finding.file &&
        item.rule === finding.rule &&
        item.sha256 === digest &&
        item.reason?.length > 30 &&
        item.reviewer &&
        item.evidence?.length,
    );
    return review ? { ...finding, reviewed: true, review } : finding;
  });
}
function checkReference() {
  const manifest = JSON.parse(readFileSync(join(root, 'reference/manifest.json'), 'utf8'));
  for (const file of manifest.files) {
    const path = resolve(root, 'reference', file.path);
    if (
      !path.startsWith(`${resolve(root, 'reference')}/`) &&
      !path.startsWith(`${resolve(root, 'reference')}\\`)
    )
      throw new Error(`Reference path escapes its directory: ${file.path}`);
    const bytes = readFileSync(path);
    if (createHash('sha256').update(bytes).digest('hex') !== file.sha256)
      throw new Error(`Pinned source changed: reference/${file.path}`);
    if (
      file.kind === 'original' &&
      createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== file.upstreamBlob
    )
      throw new Error(`Upstream Git blob mismatch: reference/${file.path}`);
  }
  report.stages.push({ name: 'Pinned Linux source hashes', status: 'PASS' });
}
try {
  checkReference();
  const files = readInventory(root);
  report.findings = reviewFindings(files, [...analyzeStructure(files), ...analyzeSources(files)]);
  for (const finding of report.findings)
    console.log(
      `${finding.file}:${finding.line} ${finding.severity} ${finding.rule}: ${finding.reason}${finding.reviewed ? ' [reviewed for these exact bytes]' : ''}`,
    );
  const violations = report.findings.some((item) => item.severity === 'ERROR');
  const reviewRequired = report.findings.some(
    (item) => item.severity === 'REVIEW_REQUIRED' && !item.reviewed,
  );
  report.statuses.ARCHITECTURE = violations ? 'FAIL' : reviewRequired ? 'REVIEW REQUIRED' : 'PASS';

  const formatted = node(
    'JavaScript / CSS / HTML / documentation format',
    'node_modules/prettier/bin/prettier.cjs',
    ['--check', '.'],
  );
  const rustFormat = node('Rust format', 'engine/build.mjs', ['fmt']);
  report.statuses.STYLE = formatted && rustFormat ? 'PASS' : 'FAIL';
  const linted = node('JavaScript static analysis', 'node_modules/eslint/bin/eslint.js', [
    '.',
    '--max-warnings',
    '0',
  ]);
  const rustClippy = node('Rust Clippy', 'engine/build.mjs', ['clippy']);
  report.statuses['STATIC ANALYSIS'] = linted && rustClippy && !violations ? 'PASS' : 'FAIL';

  if (!fast) {
    const rustCheck = node('Rust supported host compilation', 'engine/build.mjs', ['check']);
    if (!rustCheck) report.statuses['STATIC ANALYSIS'] = 'FAIL';
    const rustTests = node('Rust unit / boundary tests', 'engine/build.mjs', ['test']);
    const rustBuild = node('Native reference executable', 'engine/build.mjs', ['build']);
    // Missing native code must fail, never silently skip integration coverage.
    const jsTests = rustBuild && node('Unit / integration / regression tests', 'tools/test.mjs');
    report.statuses.TESTS = rustTests && jsTests ? 'PASS' : 'FAIL';
    report.statuses.REGRESSION = report.statuses.TESTS;
    const built = node('Client production build', 'tools/build.mjs');
    if (!built) report.statuses['STATIC ANALYSIS'] = 'FAIL';
    const audited = node('npm vulnerability audit (all severities)', npmCli(), [
      'audit',
      '--audit-level=low',
    ]);
    const lock = readFileSync(join(root, 'engine/Cargo.lock'), 'utf8');
    const rustPackages = lock.match(/^\[\[package\]\]$/gm) ?? [];
    const rustAudited =
      rustPackages.length === 1
        ? stage('Rust dependency-free manifest verification', 'cargo', [
            'metadata',
            '--manifest-path',
            'engine/Cargo.toml',
            '--no-deps',
            '--format-version=1',
            '--offline',
            '--locked',
          ])
        : stage('Rust dependency vulnerability audit', 'cargo', [
            'audit',
            '--file',
            'engine/Cargo.lock',
            '--deny',
            'warnings',
          ]);
    report.statuses.SECURITY = audited && rustAudited && !violations ? 'PASS' : 'FAIL';
  }
  const required = fast
    ? ['ARCHITECTURE', 'STATIC ANALYSIS', 'STYLE']
    : Object.keys(report.statuses).filter((key) => key !== 'QUALITY GATE');
  if (required.every((key) => report.statuses[key] === 'PASS')) report.statuses['QUALITY GATE'] = 'PASS';
} catch (error) {
  report.stages.push({ name: 'Gate infrastructure', status: 'FAIL', error: error.message });
  console.error(error.stack);
}
mkdirSync(join(root, '.quality'), { recursive: true });
writeFileSync(join(root, '.quality/report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nScope: ${report.scope}`);
for (const [name, status] of Object.entries(report.statuses)) console.log(`${name}: ${status}`);
process.exitCode = report.statuses['QUALITY GATE'] === 'PASS' ? 0 : 1;
