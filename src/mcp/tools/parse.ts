import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { HuijiMcpClient } from '../client';
import { toolResult } from './common';

const annotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
};

export function registerParseTools(server: McpServer, client: HuijiMcpClient): void {
    server.registerTool(
        'huiji_parse_wikitext',
        {
            description: 'Parse candidate wikitext on the server without saving it.',
            inputSchema: {
                text: z.string(),
                title: z.string().trim().min(1).optional(),
            },
            annotations,
        },
        async ({ text, title }) =>
            toolResult(client, async () => client.parseWikitext(text, title))
    );

    server.registerTool(
        'huiji_compare',
        {
            description: 'Compare candidate wikitext with the latest online revision without saving.',
            inputSchema: {
                title: z.string().trim().min(1),
                candidateText: z.string(),
            },
            annotations,
        },
        async ({ title, candidateText }) =>
            toolResult(client, async () => client.compare(title, candidateText))
    );
}
