/**
 * Minimal stateless MCP over HTTP (spec 136 S5): JSON-RPC 2.0 requests answered with one JSON
 * body. No sessions, no streaming, no batches. Pure: the route does auth, this does shape.
 */

export interface McpTool<C> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Returns data for the model; a thrown `ToolFailure` becomes an `isError` result. */
  call: (args: Record<string, unknown>, context: C) => Promise<unknown>;
}

/** A refusal the model should read and act on (not a protocol error). */
export class ToolFailure extends Error {}

export const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'minion-hub', version: '1.0.0' };

export interface McpReply {
  status: number;
  /** Absent for notifications (202). */
  body?: unknown;
}

const rpcError = (id: unknown, code: number, message: string, status = 200): McpReply => ({
  status,
  body: { jsonrpc: '2.0', id: id ?? null, error: { code, message } },
});
const rpcResult = (id: unknown, result: unknown): McpReply => ({
  status: 200,
  body: { jsonrpc: '2.0', id, result },
});

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export async function handleMcp<C>(
  text: string,
  tools: readonly McpTool<C>[],
  context: C,
  failureOf: (e: unknown) => string | null = () => null,
  /** What `tools/list` shows, when narrower than what `tools/call` resolves (a refused call then says why). */
  listed: readonly McpTool<C>[] = tools,
): Promise<McpReply> {
  let msg: unknown;
  try {
    msg = JSON.parse(text);
  } catch {
    return rpcError(null, -32700, 'Parse error: the body is not valid JSON.', 400);
  }
  if (!isObject(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string')
    return rpcError(null, -32600, 'Invalid request: send one JSON-RPC 2.0 request object.', 400);
  const { id, method } = msg;
  // A message without an id is a notification: accepted, never answered.
  if (id === undefined) return { status: 202 };
  if (typeof id !== 'string' && typeof id !== 'number')
    return rpcError(null, -32600, 'Invalid request: id must be a string or a number.', 400);

  if (method === 'initialize')
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    });
  if (method === 'ping') return rpcResult(id, {});
  if (method === 'tools/list')
    return rpcResult(id, {
      tools: listed.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      })),
    });
  if (method === 'tools/call') {
    const params = isObject(msg.params) ? msg.params : {};
    const tool = tools.find((t) => t.name === params.name);
    if (!tool) return rpcError(id, -32602, `Unknown tool: ${String(params.name)}.`);
    if (params.arguments !== undefined && !isObject(params.arguments))
      return rpcError(id, -32602, 'Invalid params: arguments must be an object.');
    try {
      const data = await tool.call(params.arguments ?? {}, context);
      return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(data) }] });
    } catch (e) {
      const sentence = e instanceof ToolFailure ? e.message : failureOf(e);
      if (sentence === null) return rpcError(id, -32603, 'Internal error.');
      return rpcResult(id, { isError: true, content: [{ type: 'text', text: sentence }] });
    }
  }
  return rpcError(id, -32601, `Method not found: ${method}.`);
}
