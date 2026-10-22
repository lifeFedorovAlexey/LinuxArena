import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const tests = readdirSync(resolve(root, 'tests'), { recursive: true })
  .filter((name) => name.endsWith('.test.mjs'))
  .map((name) => `tests/${name.replaceAll('\\', '/')}`)
  .sort();
if (!tests.length) throw new Error('No test suites found.');
const result = spawnSync(process.execPath, ['--test', ...tests], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
