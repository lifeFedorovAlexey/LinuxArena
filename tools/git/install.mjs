import { spawnSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

for (const hook of ['pre-commit', 'pre-push']) {
  chmodSync(fileURLToPath(new URL(`../../.githooks/${hook}`, import.meta.url)), 0o755);
}

const current = spawnSync('git', ['config', '--local', '--get', 'core.hooksPath'], {
  encoding: 'utf8',
  windowsHide: true,
});
if (current.error || ![0, 1].includes(current.status)) {
  console.error('Cannot inspect local Git hook configuration. Install hooks inside a Git checkout.');
  process.exitCode = 1;
} else if (current.stdout.trim() && current.stdout.trim() !== '.githooks') {
  console.error(
    `Existing hooksPath ${current.stdout.trim()} must be integrated explicitly; it was not overwritten.`,
  );
  process.exitCode = 1;
} else {
  const result = spawnSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], {
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
  if (process.exitCode === 0) console.log('Quality Gate hooks installed: pre-commit and pre-push.');
}
