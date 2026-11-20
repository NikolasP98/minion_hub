import { describe, expect, it } from 'vitest';
import { handleMcp, PROTOCOL_VERSION, ToolFailure, type McpTool } from './protocol';

const tools: McpTool<{ who: string }>[] = [
  {
    name: 'echo',
    description: 'Echo',
    inputSchema: { type: 'object' },
    call: async (args, c) => ({ args, who: c.who }),
  },
  {
    name: 'refuse',
    description: 'Refuse',
    inputSchema: { type: 'object' },
    call: async () => {
      throw new ToolFailure('No.');
    },
  },
  {
    name: 'boom',
    description: 'Boom',
    inputSchema: { type: 'object' },
    call: async () => {
      throw new Error('secret detail');
    },
  },
];
const send = (msg: unknown, failureOf?: (e: unknown) => string | null) =>
  handleMcp(typeof msg === 'string' ? msg : JSON.stringify(msg), tools, { who: 'k' }, failureOf);
const rpc = (method: string, params?: unknown, id: number | string = 1) => ({
  jsonrpc: '2.0',
  id,
  method,
  params,
});

describe('handleMcp', () => {
  it('initialize returns the version and server identity', async () => {
    const r = await send(rpc('initialize'));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      id: 1,
      result: { protocolVersion: PROTOCOL_VERSION, serverInfo: { name: 'minion-hub' } },
    });
  });

  it('ping answers an empty result and tools/list names every tool', async () => {
    expect((await send(rpc('ping'))).body).toMatchObject({ result: {} });
    const list = (await send(rpc('tools/list'))).body as { result: { tools: { name: string }[] } };
    expect(list.result.tools.map((t) => t.name)).toEqual(['echo', 'refuse', 'boom']);
  });

  it('notifications (no id) get 202 and no body', async () => {
    expect(await send({ jsonrpc: '2.0', method: 'notifications/initialized' })).toEqual({
      status: 202,
    });
  });

  it('tools/call returns the data as text content', async () => {
    const r = await send(rpc('tools/call', { name: 'echo', arguments: { a: 1 } }));
    const text = (r.body as { result: { content: { text: string }[] } }).result.content[0]!.text;
    expect(JSON.parse(text)).toEqual({ args: { a: 1 }, who: 'k' });
  });

  it('a ToolFailure and a mapped failure are isError results; an unmapped throw is -32603', async () => {
    expect((await send(rpc('tools/call', { name: 'refuse' }))).body).toMatchObject({
      result: { isError: true, content: [{ text: 'No.' }] },
    });
    expect((await send(rpc('tools/call', { name: 'boom' }), () => 'mapped')).body).toMatchObject({
      result: { isError: true, content: [{ text: 'mapped' }] },
    });
    const r = await send(rpc('tools/call', { name: 'boom' }));
    expect(r.body).toMatchObject({ error: { code: -32603, message: 'Internal error.' } });
    expect(JSON.stringify(r.body)).not.toContain('secret');
  });

  it('protocol errors: -32700 parse, -32600 shape, -32601 method, -32602 unknown tool/arguments', async () => {
    expect(await send('{nope')).toMatchObject({ status: 400, body: { error: { code: -32700 } } });
    for (const bad of [
      [],
      '"x"',
      { jsonrpc: '1.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', id: 1 },
      rpc('ping', undefined, {} as never),
    ])
      expect(await send(bad as never)).toMatchObject({
        status: 400,
        body: { error: { code: -32600 } },
      });
    expect((await send(rpc('nope'))).body).toMatchObject({ error: { code: -32601 } });
    expect((await send(rpc('tools/call', { name: 'zzz' }))).body).toMatchObject({
      error: { code: -32602, message: 'Unknown tool: zzz.' },
    });
    expect((await send(rpc('tools/call', { name: 'echo', arguments: [] }))).body).toMatchObject({
      error: { code: -32602 },
    });
  });
});
