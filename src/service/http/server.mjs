import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createArenaStore, ArenaError } from '../store/arena-store.mjs';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.S': 'text/plain; charset=utf-8',
  '.h': 'text/plain; charset=utf-8',
};

function respond(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? ''))
    throw new ArenaError('Ожидается Content-Type: application/json.', 415);
  const length = Number(request.headers['content-length'] ?? 0);
  if (length > 65536) throw new ArenaError('Запрос слишком большой.', 413);
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 65536) throw new ArenaError('Запрос слишком большой.', 413);
    chunks.push(chunk);
  }
  let result;
  try {
    result = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new ArenaError('Некорректный JSON.');
  }
  if (!result || typeof result !== 'object' || Array.isArray(result))
    throw new ArenaError('Ожидается JSON-объект.');
  return result;
}

function assertLocal(request, port) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  if (!hosts.has(request.headers.host)) throw new ArenaError('Недопустимый Host.', 403);
  if (request.headers.origin && ![...hosts].some((host) => request.headers.origin === `http://${host}`))
    throw new ArenaError('Запросы разрешены только из локальной арены.', 403);
  if (request.headers['sec-fetch-site'] === 'cross-site')
    throw new ArenaError('Межсайтовые запросы запрещены.', 403);
}

async function staticFile(root, rawPath) {
  let path;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    throw new ArenaError('Некорректный URL.', 400);
  }
  if (
    path.includes('\\') ||
    path.includes('\0') ||
    path.split('/').some((part) => /^agents\.md[. ]*$/i.test(part)) ||
    path.split('/').some((part) => part === '..' || part === '.')
  )
    throw new ArenaError('Файл не найден.', 404);
  let base, subpath;
  if (path === '/' || path === '/index.html') {
    base = root;
    subpath = 'index.html';
  } else if (/^\/src\/(ui|core)\/.+\.(mjs|css)$/.test(path)) {
    const area = path.split('/')[2];
    base = join(root, 'src', area);
    subpath = path.slice(`/src/${area}/`.length);
  } else if (path.startsWith('/vendor/three/addons/')) {
    base = join(root, 'node_modules', 'three', 'examples', 'jsm');
    subpath = path.slice('/vendor/three/addons/'.length);
  } else if (path.startsWith('/vendor/three/')) {
    base = join(root, 'node_modules', 'three', 'build');
    subpath = path.slice('/vendor/three/'.length);
  } else if (path.startsWith('/vendor/blockly/')) {
    base = join(root, 'node_modules', 'blockly');
    subpath = path.slice('/vendor/blockly/'.length);
  } else if (path.startsWith('/assets/')) {
    base = join(root, 'assets');
    subpath = path.slice('/assets/'.length);
  } else if (path.startsWith('/reference/')) {
    base = join(root, 'reference');
    subpath = path.slice('/reference/'.length);
  } else if (/^\/favicon\.(svg|ico)$/.test(path)) {
    base = root;
    subpath = path.slice(1);
  } else throw new ArenaError('Файл не найден.', 404);
  const candidate = resolve(base, subpath);
  let actual, actualBase;
  try {
    [actual, actualBase] = await Promise.all([realpath(candidate), realpath(base)]);
  } catch {
    throw new ArenaError('Файл не найден.', 404);
  }
  const rel = relative(actualBase, actual);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new ArenaError('Файл не найден.', 404);
  try {
    return { body: await readFile(actual), type: MIME[extname(actual)] ?? 'text/plain; charset=utf-8' };
  } catch {
    throw new ArenaError('Файл не найден.', 404);
  }
}

export async function createArenaServer(options = {}) {
  const root = options.root ?? ROOT;
  const store = await createArenaStore({ root, ...options });
  const streams = new Set();
  const server = http.createServer(async (request, response) => {
    try {
      assertLocal(request, server.address().port);
      // Check raw path before URL normalisation so traversal is never silently rewritten.
      const rawPath = request.url.split('?')[0];
      const path = new URL(request.url, 'http://localhost').pathname;
      if (rawPath !== path) throw new ArenaError('Файл не найден.', 404);
      if (path.startsWith('/api/')) {
        if (request.method === 'GET' && path === '/api/state')
          return respond(response, 200, store.snapshot());
        if (request.method === 'GET' && path === '/api/reference')
          return respond(response, 200, await store.reference());
        if (request.method === 'GET' && path === '/api/block')
          return respond(response, 200, await store.block());
        if (request.method === 'GET' && path === '/api/events') {
          response.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Content-Type-Options': 'nosniff',
          });
          const send = (state) => response.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
          send(store.snapshot());
          const unsubscribe = store.subscribe(send);
          const heartbeat = setInterval(() => response.write(': keepalive\n\n'), 15000);
          heartbeat.unref();
          streams.add(response);
          response.on('close', () => {
            clearInterval(heartbeat);
            unsubscribe();
            streams.delete(response);
          });
          return;
        }
        if (request.method !== 'POST') throw new ArenaError('Метод не поддерживается.', 405);
        const payload = await readJson(request);
        if (path === '/api/program') return respond(response, 200, await store.setProgram(payload.assembly));
        if (path === '/api/inputs') return respond(response, 200, await store.setInputs(payload));
        if (path === '/api/check') return respond(response, 200, await store.check());
        if (path === '/api/bench') return respond(response, 200, await store.benchmark());
        throw new ArenaError('Метод API не найден.', 404);
      }
      if (request.method !== 'GET' && request.method !== 'HEAD')
        throw new ArenaError('Метод не поддерживается.', 405);
      const file = await staticFile(root, rawPath);
      response.writeHead(200, {
        'Content-Type': file.type,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(request.method === 'HEAD' ? undefined : file.body);
    } catch (error) {
      if (!response.headersSent)
        respond(response, error.status ?? (error.code ? 500 : 400), { error: error.message });
      else response.end();
    }
  });
  return {
    server,
    store,
    async start(port = Number(process.env.PORT ?? 4173)) {
      await new Promise((resolveStart, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolveStart);
      });
      return `http://127.0.0.1:${server.address().port}`;
    },
    async close() {
      for (const response of streams) response.end();
      await new Promise((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()));
      });
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createArenaServer();
  const url = await app.start();
  console.log(`LinuxArena · ${url}`);
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, async () => {
      await app.close();
      process.exit(0);
    });
}
