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

export function registerRelationTools(server: McpServer, client: HuijiMcpClient): void {
    server.registerTool(
        'huiji_get_links',
        {
            description: 'List wiki pages linked from a page.',
            inputSchema: {
                title,
                namespace,
                limit: z.number().int().min(1).max(500).default(100),
                continueToken,
            },
            annotations,
        },
        async ({ title: pageTitle, namespace, limit, continueToken }) =>
            toolResult(client, async () =>
                client.getLinks(pageTitle, namespace, limit, continueToken)
            )
    );

    server.registerTool(
        'huiji_get_backlinks',
        {
            description: 'List pages linking to a page.',
            inputSchema: {
                title,
                namespace,
                limit: z.number().int().min(1).max(500).default(100),
                continueToken,
            },
            annotations,
        },
        async ({ title: pageTitle, namespace, limit, continueToken }) =>
            toolResult(client, async () =>
                client.getBacklinks(pageTitle, namespace, limit, continueToken)
            )
    );

    server.registerTool(
        'huiji_get_transclusions',
        {
            description: 'List pages that transclude the given template or module.',
            inputSchema: {
                title,
                namespace,
                limit: z.number().int().min(1).max(500).default(100),
                continueToken,
            },
            annotations,
        },
        async ({ title: pageTitle, namespace, limit, continueToken }) =>
            toolResult(client, async () =>
                client.getTransclusions(pageTitle, namespace, limit, continueToken)
            )
    );
}
