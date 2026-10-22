import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createArenaServer } from '../../src/service/http/server.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));

test(
  'real MCP stdio handshake, discovery, read and mutation share HTTP arena state',
  { timeout: 30000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'linuxarena-mcp-'));
    const app = await createArenaServer({ root, statePath: join(directory, 'state.json') });
    const url = await app.start(0);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(root, 'src/service/mcp/server.mjs')],
      cwd: root,
      env: { ...process.env, LINUXARENA_URL: url },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'linuxarena-test', version: '0.1.0' }, { capabilities: {} });
    t.after(async () => {
      await client.close();
      await app.close();
      assert.equal(dirname(directory), resolve(tmpdir()));
      assert.ok(basename(directory).startsWith('linuxarena-mcp-'));
      await rm(directory, { recursive: true, force: true });
    });
    await client.connect(transport);
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 6);
    assert.ok(listed.tools.some((tool) => tool.name === 'arena_read_block'));
    const read = await client.callTool({ name: 'arena_state', arguments: {} });
    assert.equal(read.isError, false);
    assert.equal(JSON.parse(read.content[0].text).revision, 0);
    const block = await client.callTool({ name: 'arena_read_block', arguments: {} });
    assert.equal(block.isError, false);
    assert.equal(JSON.parse(block.content[0].text).manifest.ref, 'v6.18.58');
    const mutation = await client.callTool({
      name: 'arena_set_inputs',
      arguments: { loadAddress: '0x2100000' },
    });
    assert.equal(mutation.isError, false);
    const http = await (await fetch(`${url}/api/state`)).json();
    assert.equal(http.inputs.loadAddress, '0x2100000');
    assert.equal(http.evaluation.output, '0x2200000');
    const invalid = await client.callTool({ name: 'arena_set_program', arguments: { assembly: 'syscall' } });
    assert.equal(invalid.isError, true);
    assert.equal((await (await fetch(`${url}/api/state`)).json()).revision, 1);
  },
);

test(
  'MCP refuses 307 and 308 redirects without forwarding candidate data to another origin',
  { timeout: 30000 },
  async (t) => {
    const received = [];
    let targetRequests = 0;
    let targetBytes = 0;
    let redirectStatus = 307;
    const target = createServer(async (request, response) => {
      targetRequests++;
      for await (const chunk of request) targetBytes += chunk.length;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{}');
    });
    await new Promise((resolveListen) => {
      target.listen(0, '127.0.0.1', resolveListen);
    });
    const redirect = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      received.push({
        method: request.method,
        path: request.url,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      response.writeHead(redirectStatus, { Location: `http://127.0.0.1:${target.address().port}/capture` });
      response.end();
    });
    await new Promise((resolveListen) => {
      redirect.listen(0, '127.0.0.1', resolveListen);
    });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(root, 'src/service/mcp/server.mjs')],
      cwd: root,
      env: { ...process.env, LINUXARENA_URL: `http://127.0.0.1:${redirect.address().port}` },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'linuxarena-redirect-test', version: '0.1.0' }, { capabilities: {} });
    t.after(async () => {
      await client.close();
      await Promise.all(
        [target, redirect].map(
          (server) =>
            new Promise((resolveClose, reject) => {
              server.close((error) => (error ? reject(error) : resolveClose()));
            }),
        ),
      );
    });
    await client.connect(transport);
    for (const status of [307, 308]) {
      redirectStatus = status;
      const args = { assembly: `candidate-private-marker-${status}` };
      const result = await client.callTool({ name: 'arena_set_program', arguments: args });
      assert.equal(result.isError, true, `${status} must fail instead of following the redirect`);
      assert.deepEqual(received.at(-1), { method: 'POST', path: '/api/program', body: JSON.stringify(args) });
      assert.equal(targetRequests, 0, `${status} must not reach a second origin`);
      assert.equal(targetBytes, 0, `${status} must not forward the candidate body`);
    }
    assert.equal(received.length, 2);
  },
);
