import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { HuijiMcpClient } from '../client';
import { toolResult } from './common';

const title = z.string().trim().min(1, 'title must not be empty');
const namespace = z.number().int().optional();
const continueToken = z.string().min(1).optional();
const annotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
};

export function registerPageTools(server: McpServer, client: HuijiMcpClient): void {
    server.registerTool(
        'huiji_get_page',
        {
            description: 'Fetch the latest source and revision metadata for one page.',
            inputSchema: { title },
            annotations,
        },
        async ({ title: pageTitle }) => toolResult(client, async () => client.getPage(pageTitle))
    );

    server.registerTool(
        'huiji_get_pages',
        {
            description: 'Fetch latest source and revision metadata for up to 50 pages in one query.',
            inputSchema: { titles: z.array(title).min(1).max(50) },
            annotations,
        },
        async ({ titles }) =>
            toolResult(client, async () => ({ pages: await client.getPages(titles) }))
    );

    server.registerTool(
        'huiji_search_pages',
        {
            description: 'Search wiki pages with optional namespace filtering and continuation.',
            inputSchema: {
                query: z.string().trim().min(1),
                namespace,
                limit: z.number().int().min(1).max(100).default(20),
                continueToken,
            },
            annotations,
        },
        async ({ query, namespace, limit, continueToken }) =>
            toolResult(client, async () =>
                client.searchPages(query, namespace, limit, continueToken)
            )
    );
}
