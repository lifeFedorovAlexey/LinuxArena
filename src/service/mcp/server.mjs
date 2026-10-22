import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const baseUrl = new URL(process.env.LINUXARENA_URL ?? 'http://127.0.0.1:4173');
if (
  !['127.0.0.1', 'localhost', '[::1]'].includes(baseUrl.hostname) ||
  baseUrl.protocol !== 'http:' ||
  baseUrl.username ||
  baseUrl.password
) {
  throw new Error('LINUXARENA_URL must be a local HTTP URL.');
}
const noArgs = { type: 'object', properties: {}, additionalProperties: false };
const tools = [
  {
    name: 'arena_state',
    description:
      'Read the current LinuxArena candidate, execution trace, checks and native baseline timings.',
    inputSchema: noArgs,
  },
  {
    name: 'arena_read_block',
    description:
      'Read the Linux v6.18.58 source provenance, original ASM, contracts and layer model for the startup_64 relocation block.',
    inputSchema: noArgs,
  },
  {
    name: 'arena_set_program',
    description:
      'Replace the local candidate ASM within the supported block vocabulary. This changes the visible model; it never executes arbitrary native assembly.',
    inputSchema: {
      type: 'object',
      properties: { assembly: { type: 'string', maxLength: 16000 } },
      required: ['assembly'],
      additionalProperties: false,
    },
  },
  {
    name: 'arena_set_inputs',
    description:
      'Change relocation input values. Hexadecimal strings preserve all 64 bits. Changes are immediately visible in the arena.',
    inputSchema: {
      type: 'object',
      properties: {
        loadAddress: { type: 'string' },
        alignment: { type: 'string' },
        minimumAddress: { type: 'string' },
        relocatable: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'arena_check',
    description:
      'Check the interpreted candidate against Linux arithmetic semantics and independently verify the fixed Rust translation against native adapted Linux ASM. Does not verify boot or promote a champion.',
    inputSchema: noArgs,
  },
  {
    name: 'arena_benchmark',
    description:
      'Measure isolated native ASM versus the fixed Rust port. Results do NOT apply to edits in the interpreted candidate, do NOT measure Linux boot and cannot establish a champion.',
    inputSchema: noArgs,
  },
];
const routes = {
  arena_state: ['GET', '/api/state'],
  arena_read_block: ['GET', '/api/block'],
  arena_set_program: ['POST', '/api/program'],
  arena_set_inputs: ['POST', '/api/inputs'],
  arena_check: ['POST', '/api/check'],
  arena_benchmark: ['POST', '/api/bench'],
};
const server = new Server({ name: 'linuxarena', version: '0.1.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const route = routes[request.params.name];
  if (!route) return { isError: true, content: [{ type: 'text', text: 'Unknown arena tool.' }] };
  try {
    const [method, path] = route;
    const response = await fetch(new URL(path, baseUrl), {
      method,
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {},
      body: method === 'POST' ? JSON.stringify(request.params.arguments ?? {}) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(60000),
    });
    const payload = await response.json();
    return { isError: !response.ok, content: [{ type: 'text', text: JSON.stringify(payload) }] };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Arena unavailable. Start npm run dev first. ${error.message}` }],
    };
  }
});
await server.connect(new StdioServerTransport());
