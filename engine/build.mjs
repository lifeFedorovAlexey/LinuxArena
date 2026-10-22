import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const action = process.argv[2] ?? 'build';
if (!['build', 'test', 'fmt', 'check', 'clippy', 'gate'].includes(action) || process.argv.length > 3) {
  console.error('Usage: node engine/build.mjs build|test|fmt|check|clippy|gate');
  process.exit(2);
}

const expectedHost =
  process.platform === 'win32'
    ? 'x86_64-pc-windows-gnu'
    : process.platform === 'linux'
      ? 'x86_64-unknown-linux-gnu'
      : null;
if (process.arch !== 'x64' || !expectedHost) {
  console.error('The native arithmetic gate supports x86_64 GNU Windows and GNU Linux hosts only.');
  process.exit(1);
}

// Never install tools or change the user's default. Windows needs an installed
// GNU host toolchain; Linux uses its configured native toolchain.
let toolchain;
if (process.platform === 'win32') {
  const installed = spawnSync('rustup', ['toolchain', 'list'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000,
  });
  if (installed.status === 0) {
    const gnu = installed.stdout
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/)[0])
      .filter((name) => name.endsWith('-x86_64-pc-windows-gnu'));
    toolchain = gnu.find((name) => name === '1.99.0-x86_64-pc-windows-gnu') ?? gnu[0];
  }
  if (!toolchain) {
    console.error(
      'An installed x86_64-pc-windows-gnu Rust toolchain is required. No toolchain was installed or skipped.',
    );
    process.exit(1);
  }
}

const selector = toolchain ? [`+${toolchain}`] : [];
const version = spawnSync('rustc', [...selector, '--version', '--verbose'], {
  encoding: 'utf8',
  windowsHide: true,
  timeout: 10_000,
});
if (
  version.error ||
  version.status !== 0 ||
  !version.stdout.split(/\r?\n/).includes(`host: ${expectedHost}`)
) {
  console.error(version.error?.message ?? version.stderr ?? '');
  console.error(`The active Rust host must be ${expectedHost}; its availability could not be verified.`);
  process.exit(1);
}
if (process.env.CARGO_BUILD_TARGET) {
  console.error(
    'Unset CARGO_BUILD_TARGET: the selected native toolchain fixes the host and keeps the executable in engine/target/release.',
  );
  process.exit(1);
}
console.log(`[engine] ${version.stdout.split(/\r?\n/)[0]} · ${expectedHost}`);

const cargoArguments = (stage, release = false) => {
  if (stage === 'fmt') return ['fmt', '--all', '--', '--check'];
  return [
    stage,
    '--offline',
    '--locked',
    '--all-features',
    ...(release || stage === 'build' ? ['--release'] : []),
    ...(['check', 'clippy'].includes(stage) ? ['--all-targets'] : []),
    ...(stage === 'clippy' ? ['--', '-D', 'warnings'] : []),
  ];
};
const stages =
  action === 'gate'
    ? [['fmt'], ['clippy'], ['clippy', true], ['check'], ['check', true], ['test'], ['test', true], ['build']]
    : ['clippy', 'check', 'test'].includes(action)
      ? [[action], [action, true]]
      : [[action]];
for (const [stage, release] of stages) {
  const args = cargoArguments(stage, release);
  console.log(`[engine] cargo ${args.join(' ')}`);
  const result = spawnSync('cargo', [...selector, ...args], {
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    // A gate must also work on filesystems/sandboxes without cache hard links.
    // Disable only incremental caching; diagnostics and compiler lints stay on.
    env: {
      ...process.env,
      CARGO_INCREMENTAL: '0',
      CARGO_TARGET_DIR: fileURLToPath(new URL('./target', import.meta.url)),
    },
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
