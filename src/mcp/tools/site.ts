import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { HuijiMcpClient } from '../client';
import { toolResult } from './common';

const readOnlyAnnotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
};

export function registerSiteTools(server: McpServer, client: HuijiMcpClient): void {
    server.registerTool(
        'huiji_whoami',
        {
            description: 'Return the current MediaWiki API identity, groups, and rights.',
            annotations: readOnlyAnnotations,
        },
        async () => toolResult(client, async () => client.whoAmI())
    );

    server.registerTool(
        'huiji_get_site_info',
        {
            description: 'Return Huiji Wiki general site information and namespace definitions.',
            annotations: readOnlyAnnotations,
        },
        async () => toolResult(client, async () => client.getSiteInfo())
    );
}
