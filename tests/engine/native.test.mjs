import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const executable = fileURLToPath(
  new URL(
    `../../engine/target/release/linuxarena-engine${process.platform === 'win32' ? '.exe' : ''}`,
    import.meta.url,
  ),
);
const nativeOptions = {
  skip:
    process.env.REQUIRE_NATIVE_ENGINE !== '1' &&
    !existsSync(executable) &&
    'Build the native engine first: node engine/build.mjs build',
};

function run(...args) {
  const result = spawnSync(executable, args, { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  assert.ifError(result.error);
  return { status: result.status, value: JSON.parse(result.stdout) };
}

test('native Rust translation agrees with the Linux instruction fragment', nativeOptions, () => {
  const { status, value } = run('check');
  assert.equal(status, 0);
  assert.equal(value.baseline, 'v6.18.58');
  assert.equal(value.status, 'passed');
  assert.equal(value.mismatches, 0);
  assert.equal(value.cases, value.boundary_cases + value.random_cases);
  assert.ok(value.boundary_cases >= 500);
  assert.ok(value.random_cases >= 100_000);
  assert.equal(value.boot_verified, false);
});

test('CLI preserves u64 values and distinguishes arithmetic from boot validity', nativeOptions, () => {
  const { status, value } = run('evaluate', '0xffffffffffffffff', '0x200000', '0x1000000');
  assert.equal(status, 0);
  assert.equal(value.input.load_address, '0xffffffffffffffff');
  assert.equal(value.reference, '0x1000000');
  assert.equal(value.rust, value.reference);
  assert.equal(value.equal, true);
  assert.equal(value.boot_verified, false);
  const outsideContract = run('evaluate', '0x100000001', '0', '0');
  assert.equal(outsideContract.value.rust, '0x200000000');
  assert.equal(outsideContract.value.alignment_contract_valid, false);
});

test('CLI rejects truncated or malformed values with machine-readable errors', nativeOptions, () => {
  for (const args of [
    ['evaluate', '0x10000000000000000', '0x200000', '0'],
    ['evaluate', '0', '0x100000000', '0'],
    ['evaluate', '-1', '1', '0'],
    ['evaluate'],
  ]) {
    const { status, value } = run(...args);
    assert.equal(status, 2);
    assert.equal(value.status, 'error');
    assert.equal(typeof value.error, 'string');
  }
});

test('native measurements are actual samples and cannot imply a kernel record', nativeOptions, () => {
  const { status, value } = run('bench');
  assert.equal(status, 0);
  assert.equal(value.status, 'measured');
  assert.equal(value.unit, 'ns/op');
  assert.equal(value.reference_samples.length, value.sample_count);
  assert.equal(value.rust_samples.length, value.sample_count);
  assert.ok(value.sample_count >= 9);
  assert.ok(
    [...value.reference_samples, ...value.rust_samples].every(
      (sample) => Number.isFinite(sample) && sample > 0,
    ),
  );
  assert.equal(value.decision, 'informational');
  assert.equal(value.record_eligible, false);
  assert.equal(value.boot_verified, false);
});
