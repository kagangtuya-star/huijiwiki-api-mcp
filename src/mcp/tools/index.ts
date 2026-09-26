import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { HuijiMcpClient } from '../client';
import { registerEditTools } from './edit';
import { registerPageTools } from './pages';
import { registerParseTools } from './parse';
import { registerRelationTools } from './relations';
import { registerSiteTools } from './site';

export function registerTools(server: McpServer, client: HuijiMcpClient): void {
    registerSiteTools(server, client);
    registerPageTools(server, client);
    registerRelationTools(server, client);
    registerParseTools(server, client);
    registerEditTools(server, client);
}
