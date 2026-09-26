import type { HuijiMcpClient } from '../client';

export async function toolResult<T extends object>(
    client: HuijiMcpClient,
    operation: () => Promise<T>
) {
    try {
        const result = await operation();
        return {
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
            structuredContent: result as Record<string, unknown>,
        };
    } catch (error) {
        const safeError = client.safeError(error);
        const result = { error: safeError };
        return {
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
            structuredContent: result,
            isError: true,
        };
    }
}
