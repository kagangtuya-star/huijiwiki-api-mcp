#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { HuijiMcpClient } from './client';
import { registerTools } from './tools';

export function createServer(client = new HuijiMcpClient()): McpServer {
    const server = new McpServer({
        name: 'huijiwiki-mcp',
        version: '1.0.0',
    });
    registerTools(server, client);
    return server;
}

export async function main(): Promise<void> {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

if (require.main === module) {
    main().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`huijiwiki-mcp failed: ${message}\n`);
        process.exitCode = 1;
    });
}
