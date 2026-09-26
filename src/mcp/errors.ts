export class McpOperationError extends Error {
    constructor(
        public readonly code: string,
        message: string
    ) {
        super(message);
        this.name = 'McpOperationError';
    }
}

export function redactSecrets(message: string, secrets: Array<string | undefined>): string {
    return secrets
        .filter((secret): secret is string => Boolean(secret))
        .reduce((safe, secret) => safe.split(secret).join('[REDACTED]'), message);
}
