import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createArenaServer } from '../../src/service/http/server.mjs';
import { REFERENCE_ASM, CONTRACT_CASES } from '../../src/core/placement/index.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const nativeFixture = async (command) =>
  command === 'check'
    ? { status: 'passed', cases: 100540, mismatches: 0, boot_verified: false }
    : {
        status: 'measured',
        reference_median: 1,
        rust_median: 1,
        decision: 'informational',
        boot_verified: false,
      };

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'linuxarena-service-'));
  const options = { root, statePath: join(directory, 'state.json'), runNative: nativeFixture };
  let app = await createArenaServer(options);
  let url = await app.start(0);
  t.after(async () => {
    await app.close();
    assert.equal(dirname(directory), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('linuxarena-service-'));
    await rm(directory, { recursive: true, force: true });
  });
  return {
    get url() {
      return url;
    },
    get app() {
      return app;
    },
    options,
    async restart() {
      await app.close();
      app = await createArenaServer(options);
      url = await app.start(0);
    },
    async request(path, body, headers = {}) {
      const response = await fetch(`${url}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { response, data: await response.json() };
    },
  };
}

test('edits persist, invalid programs do not replace the last valid candidate', async (t) => {
  const f = await fixture(t);
  const reference = await f.request('/api/block');
  assert.equal(reference.response.status, 200);
  assert.equal(reference.data.manifest.ref, 'v6.18.58');
  assert.equal(reference.data.id, reference.data.contract.id);
  const originalPath = join(root, 'reference', reference.data.manifest.files[0].path);
  const originalHash = createHash('sha256')
    .update(await readFile(originalPath))
    .digest('hex');
  assert.equal(originalHash, reference.data.manifest.files[0].sha256);
  const original = await f.request('/api/state');
  assert.equal(original.response.status, 200);
  assert.equal(original.data.program.isReference, true);
  const modified = REFERENCE_ASM.replace('jae', 'jb');
  const saved = await f.request('/api/program', { assembly: modified });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.data.revision, 1);
  assert.equal(saved.data.program.isReference, false);
  const rejected = await f.request('/api/program', { assembly: 'syscall\n' });
  assert.equal(rejected.response.status, 400);
  assert.equal((await f.request('/api/state')).data.revision, 1);
  const persisted = JSON.parse(await readFile(f.options.statePath, 'utf8'));
  assert.equal(persisted.program.assembly, saved.data.program.assembly);
  assert.equal(
    createHash('sha256')
      .update(await readFile(originalPath))
      .digest('hex'),
    originalHash,
  );
  await f.restart();
  assert.equal((await f.request('/api/state')).data.program.assembly, saved.data.program.assembly);
});

test('candidate verification catches semantic regressions; native timings keep a separate scope', async (t) => {
  const f = await fixture(t);
  const correct = await f.request('/api/check', {});
  assert.equal(correct.data.checks.status, 'passed');
  assert.equal(correct.data.checks.candidate.total, 4187 + CONTRACT_CASES.length);
  assert.deepEqual(
    correct.data.checks.candidate.groups.map(({ id, total, passed }) => ({ id, total, passed })),
    [
      { id: 'requirements', total: 12, passed: 12 },
      { id: 'current', total: 1, passed: 1 },
      { id: 'boundaries', total: 90, passed: 90 },
      { id: 'random', total: 4096, passed: 4096 },
    ],
  );
  assert.equal(correct.data.checks.candidate.failed, 0);
  await f.request('/api/program', { assembly: REFERENCE_ASM.replace('jae', 'jb') });
  const wrong = await f.request('/api/check', {});
  assert.equal(wrong.data.checks.status, 'failed');
  assert.ok(wrong.data.checks.candidate.failed > 0);
  assert.ok(wrong.data.checks.candidate.failures.length > 0);
  assert.equal(wrong.data.checks.native.status, 'passed');
  const bench = await f.request('/api/bench', {});
  assert.equal(bench.data.benchmark.appliesTo, 'fixed-rust-port');
  assert.equal(bench.data.benchmark.candidateProgramHash, null);
  assert.equal(bench.data.benchmark.boot_verified, false);
});

test('expression-generated register operands survive API persistence and restart', async (t) => {
  const f = await fixture(t);
  const assembly = 'movq $9, %r8\nmovq $7, %r9\naddq %r9, %r8\nmovq %r8, %rbp\n';
  const saved = await f.request('/api/program', { assembly });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.data.evaluation.output, '0x10');
  assert.match(saved.data.program.assembly, /addq %r9, %r8/);
  await f.restart();
  const restored = (await f.request('/api/state')).data;
  assert.equal(restored.evaluation.output, '0x10');
  assert.equal(restored.program.assembly, saved.data.program.assembly);
  const invalid = await f.request('/api/program', { assembly: 'movq %r10, %rbp\n' });
  assert.equal(invalid.response.status, 400);
  assert.equal((await f.request('/api/state')).data.program.assembly, restored.program.assembly);
});

test('restart preserves the candidate but invalidates checks and native timings from the previous engine session', async (t) => {
  const f = await fixture(t);
  await f.request('/api/inputs', { loadAddress: '0x2100000' });
  const edited = await f.request('/api/program', { assembly: REFERENCE_ASM.replace('jae', 'jb') });
  const checked = await f.request('/api/check', {});
  assert.equal(checked.data.checks.status, 'failed');
  const measured = await f.request('/api/bench', {});
  assert.equal(measured.data.benchmark.status, 'measured');
  await f.restart();
  const restored = (await f.request('/api/state')).data;
  assert.equal(restored.program.assembly, edited.data.program.assembly);
  assert.equal(restored.inputs.loadAddress, '0x2100000');
  assert.equal(restored.revision, measured.data.revision);
  assert.equal(restored.checks.status, 'not-run');
  assert.equal(restored.checks.candidate, null);
  assert.equal(restored.checks.native, null);
  assert.equal(restored.checks.checkedAt, null);
  assert.equal(restored.benchmark, null);
});

test('input boundaries reject coercion and preserve previously valid state', async (t) => {
  const f = await fixture(t);
  const changed = await f.request('/api/inputs', { loadAddress: '0x1000001' });
  assert.equal(changed.data.evaluation.output, '0x1200000');
  const revision = changed.data.revision;
  for (const input of [
    { alignment: '-1' },
    { loadAddress: '0x10000000000000000' },
    { relocatable: 'false' },
    { unknown: '0' },
    JSON.parse('{"__proto__":"bad"}'),
  ]) {
    assert.equal((await f.request('/api/inputs', input)).response.status, 400);
    assert.equal((await f.request('/api/state')).data.revision, revision);
  }
});

test('private files, traversal and cross-origin mutations are rejected', async (t) => {
  const f = await fixture(t);
  for (const path of [
    '/.git/config',
    '/.arena/state.json',
    '/package.json',
    '/src/service/store/arena-store.mjs',
    '/src/core/%2e%2e%2fservice/store/arena-store.mjs',
    '/src/ui/AGENTS.md',
    '/src/core/AGENTS.md',
    '/reference/AGENTS.md',
    '/reference/agents.md',
    '/reference/AGENTS.md.',
    '/reference/AGENTS.md%20',
    '/vendor/three/%5c..%5cpackage.json',
  ]) {
    assert.equal((await fetch(`${f.url}${path}`)).status, 404, path);
  }
  assert.equal((await fetch(`${f.url}/src/core/placement/index.mjs`)).status, 200);
  assert.equal((await fetch(`${f.url}/src/ui/styles.css`)).status, 200);
  assert.equal(
    (await f.request('/api/inputs', { loadAddress: '0' }, { Origin: 'https://example.org' })).response.status,
    403,
  );
  assert.equal(
    (
      await fetch(`${f.url}/api/inputs`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: '{}',
      })
    ).status,
    415,
  );
  assert.equal(
    (
      await fetch(`${f.url}/api/inputs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'x'.repeat(65537),
      })
    ).status,
    413,
  );
  assert.equal((await f.request('/api/state')).data.revision, 0);
});

test('SSE exposes a committed remote change without polling', async (t) => {
  const f = await fixture(t);
  const response = await fetch(`${f.url}/api/events`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  async function event() {
    while (!buffer.includes('\n\n')) {
      const { done, value } = await reader.read();
      assert.equal(done, false);
      buffer += decoder.decode(value, { stream: true });
    }
    const end = buffer.indexOf('\n\n');
    const message = buffer.slice(0, end);
    buffer = buffer.slice(end + 2);
    return JSON.parse(
      message
        .split('\n')
        .find((line) => line.startsWith('data: '))
        .slice(6),
    );
  }
  try {
    assert.equal((await event()).revision, 0);
    await f.request('/api/inputs', { loadAddress: '0x2100000' });
    const update = await event();
    assert.equal(update.revision, 1);
    assert.equal(update.inputs.loadAddress, '0x2100000');
    assert.equal(update.evaluation.output, '0x2200000');
  } finally {
    await reader.cancel();
  }
});
