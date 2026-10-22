import { cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = resolve(root, 'dist');
await mkdir(output, { recursive: true });
await cp(resolve(root, 'index.html'), resolve(output, 'index.html'));
for (const area of ['ui', 'core'])
  await cp(resolve(root, 'src', area), resolve(output, 'src', area), {
    recursive: true,
    filter: (path) => !path.endsWith('AGENTS.md'),
  });
await cp(resolve(root, 'reference'), resolve(output, 'reference'), { recursive: true });
await cp(resolve(root, 'node_modules/three/build'), resolve(output, 'vendor/three'), { recursive: true });
await cp(resolve(root, 'node_modules/three/examples/jsm'), resolve(output, 'vendor/three/addons'), {
  recursive: true,
});
await mkdir(resolve(output, 'vendor/blockly/msg'), { recursive: true });
for (const file of ['blockly_compressed.js', 'msg/ru.js', 'msg/en.js', 'LICENSE'])
  await cp(resolve(root, 'node_modules/blockly', file), resolve(output, 'vendor/blockly', file));
await cp(resolve(root, 'node_modules/blockly/media'), resolve(output, 'vendor/blockly/media'), {
  recursive: true,
});
try {
  await cp(resolve(root, 'assets'), resolve(output, 'assets'), { recursive: true });
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
console.log('Built dist/. Interactive checks and persistence require the local Node service.');
