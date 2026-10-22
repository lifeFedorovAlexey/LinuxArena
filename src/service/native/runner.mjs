import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
const execFileAsync = promisify(execFile);
export async function nativeRunner(root, command) {
  const executable = join(
    root,
    'engine',
    'target',
    'release',
    process.platform === 'win32' ? 'linuxarena-engine.exe' : 'linuxarena-engine',
  );
  try {
    const { stdout } = await execFileAsync(executable, [command], {
      cwd: root,
      windowsHide: true,
      timeout: 45000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (error) {
    // The native runner deliberately writes diagnostic JSON even on failed checks.
    if (error.stdout) {
      try {
        return JSON.parse(error.stdout);
      } catch {
        /* fall through to explicit unavailable status */
      }
    }
    return {
      status: 'unavailable',
      scope: 'fixed-rust-port',
      boot_verified: false,
      reason:
        error.code === 'ENOENT'
          ? 'Сначала соберите engine: npm run engine:build.'
          : 'Нативная проверка недоступна.',
    };
  }
}
