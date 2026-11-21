/** A signed-in harness connection to the MCP endpoint (spec 143), as the settings UI lists it. */
export interface McpConnectionRow {
  id: string;
  appName: string;
  personName: string | null;
  mine: boolean;
  approvedAt: string;
  lastUsedAt: string | null;
}
