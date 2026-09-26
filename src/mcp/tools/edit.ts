import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { HuijiMcpClient } from '../client';
import { toolResult } from './common';

const title = z.string().trim().min(1, 'title must not be empty');
const summary = z.string().trim().min(1, 'summary must not be empty');
const writeAnnotations = {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
};

export function registerEditTools(server: McpServer, client: HuijiMcpClient): void {
    server.registerTool(
        'huiji_update_page',
        {
            description:
                'Update an existing page only when its latest revision matches expectedRevId.',
            inputSchema: {
                title,
                text: z.string(),
                expectedRevId: z.number().int().positive(),
                summary,
                minor: z.boolean().optional(),
            },
            annotations: writeAnnotations,
        },
        async (input) => toolResult(client, async () => client.updatePage(input))
    );

    server.registerTool(
        'huiji_create_page',
        {
            description: 'Create a new page and fail if the page already exists.',
            inputSchema: {
                title,
                text: z.string(),
                summary,
                minor: z.boolean().optional(),
            },
            annotations: writeAnnotations,
        },
        async (input) => toolResult(client, async () => client.createPage(input))
    );

    server.registerTool(
        'huiji_purge',
        {
            description: 'Purge caches for up to 50 pages without editing them.',
            inputSchema: { titles: z.array(title).min(1).max(50) },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true,
            },
        },
        async ({ titles }) => toolResult(client, async () => client.purge(titles))
    );
}
