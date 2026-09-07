import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const server = new McpServer({ name: "fixture", version: "1.0" });
server.registerTool(
  "read_issues",
  { inputSchema: { cursor: z.number().optional() } },
  async () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify({ records: [], nextCursor: null, complete: true }),
      },
    ],
  }),
);
server.registerTool("delete_issue", { inputSchema: {} }, async () => {
  throw new Error("Mutation must never execute");
});
await server.connect(new StdioServerTransport());
