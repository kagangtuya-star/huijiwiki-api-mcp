import { HuijiWiki, LOG_LEVEL } from '../HuijiWiki/HuijiWiki';
import type { RequestParams } from '../HuijiWiki/HuijiRequester';
import type { MWResponseBase, MWResponseEdit } from '../HuijiWiki/typeMWApiResponse';
import { McpOperationError, redactSecrets } from './errors';
import type { McpConfig, PageRevision, WikiClient, WikiFactory } from './types';

const DEFAULT_USER_AGENT = 'PF2-Wiki-MCP/1.0 (huijiwiki-api)';

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as JsonRecord)
        : {};
}

function array(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
    const value = env[name]?.trim();
    if (!value) {
        throw new McpOperationError('configuration-error', `${name} is required.`);
    }
    return value;
}

export function loadMcpConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
    const prefix = requiredEnv(env, 'HUIJI_PREFIX');
    const authKey = requiredEnv(env, 'HUIJI_AUTHKEY');
    const botUsername = env.HUIJI_BOT_USERNAME?.trim() || undefined;
    const botPassword = env.HUIJI_BOT_PASSWORD || undefined;

    if (Boolean(botUsername) !== Boolean(botPassword)) {
        throw new McpOperationError(
            'configuration-error',
            'HUIJI_BOT_USERNAME and HUIJI_BOT_PASSWORD must be provided together.'
        );
    }

    return {
        prefix,
        authKey,
        botUsername,
        botPassword,
        userAgent: env.HUIJI_USER_AGENT?.trim() || DEFAULT_USER_AGENT,
    };
}

function defaultWikiFactory(prefix: string, authKey: string): HuijiWiki {
    return new HuijiWiki(prefix, authKey, { logLevel: LOG_LEVEL.NONE });
}

function pageValues(response: unknown): JsonRecord[] {
    const pages = record(record(response).query).pages;
    if (Array.isArray(pages)) {
        return pages.map(record);
    }
    return Object.values(record(pages)).map(record);
}

export function normalizePagesResponse(response: unknown): PageRevision[] {
    return pageValues(response).map((page) => {
        const revision = record(array(page.revisions)[0]);
        const mainSlot = record(record(revision.slots).main);
        const missing = Object.prototype.hasOwnProperty.call(page, 'missing');
        const content = mainSlot.content ?? mainSlot['*'] ?? revision.content ?? revision['*'];

        return {
            title: typeof page.title === 'string' ? page.title : '',
            pageid: optionalNumber(page.pageid) ?? null,
            namespace: optionalNumber(page.ns) ?? 0,
            missing,
            revid: optionalNumber(revision.revid) ?? null,
            parentid: optionalNumber(revision.parentid) ?? null,
            timestamp: optionalString(revision.timestamp) ?? null,
            contentmodel:
                optionalString(mainSlot.contentmodel) ??
                optionalString(revision.contentmodel) ??
                null,
            content: typeof content === 'string' ? content : null,
        };
    });
}

function validateTitle(title: string): string {
    const value = title.trim();
    if (!value) {
        throw new McpOperationError('invalid-input', 'title must be a non-empty string.');
    }
    return value;
}

function validateSummary(summary: string): string {
    const value = summary.trim();
    if (!value) {
        throw new McpOperationError('invalid-input', 'summary must be a non-empty string.');
    }
    return value;
}

function assertNoMediaWikiError(response: MWResponseBase, operation: string): void {
    if (response.error) {
        throw new McpOperationError(
            response.error.code || 'mediawiki-error',
            `${operation} failed: ${response.error.info || response.error.code}`
        );
    }
}

function encodeContinuation(response: unknown, key: string): string | undefined {
    const continuation = record(record(response).continue);
    const moduleToken = optionalString(continuation[key]);
    if (!moduleToken) {
        return undefined;
    }
    return Buffer.from(
        JSON.stringify({
            [key]: moduleToken,
            ...(optionalString(continuation.continue)
                ? { continue: continuation.continue }
                : {}),
        })
    ).toString('base64url');
}

function decodeContinuation(token: string | undefined, key: string): Record<string, string> {
    if (!token) {
        return {};
    }
    try {
        const continuation = record(JSON.parse(Buffer.from(token, 'base64url').toString('utf8')));
        const moduleToken = optionalString(continuation[key]);
        if (!moduleToken) {
            throw new Error('module token is missing');
        }
        return {
            [key]: moduleToken,
            ...(optionalString(continuation.continue)
                ? { continue: String(continuation.continue) }
                : {}),
        };
    } catch {
        throw new McpOperationError('invalid-input', 'continueToken is invalid for this tool.');
    }
}

export class HuijiMcpClient {
    private config?: McpConfig;
    private wiki?: WikiClient;
    private loggedIn = false;
    private compareParameters?: Set<string>;

    constructor(
        private readonly env: NodeJS.ProcessEnv = process.env,
        private readonly wikiFactory: WikiFactory = defaultWikiFactory
    ) {}

    private getConfig(): McpConfig {
        this.config ??= loadMcpConfig(this.env);
        return this.config;
    }

    private getWiki(): WikiClient {
        if (!this.wiki) {
            const config = this.getConfig();
            this.wiki = this.wikiFactory(config.prefix, config.authKey);
            this.wiki.setUserAgent(config.userAgent);
        }
        return this.wiki;
    }

    private async getAuthenticatedWiki(forceLogin = false): Promise<WikiClient> {
        const wiki = this.getWiki();
        if (this.loggedIn && !forceLogin) {
            return wiki;
        }

        const config = this.getConfig();
        if (!config.botUsername || !config.botPassword) {
            throw new McpOperationError(
                'authentication-required',
                'HUIJI_BOT_USERNAME and HUIJI_BOT_PASSWORD are required for this operation.'
            );
        }

        const success = await wiki.apiLogin(config.botUsername, config.botPassword);
        if (!success) {
            const detail = wiki.getLastErrorMessage();
            throw new McpOperationError(
                'login-failed',
                detail ? `Huiji Wiki login failed: ${detail}` : 'Huiji Wiki login failed.'
            );
        }
        this.loggedIn = true;
        return wiki;
    }

    private async request<T extends MWResponseBase = MWResponseBase>(
        params: { action: string } & Record<string, unknown>,
        method?: 'GET' | 'POST'
    ): Promise<T> {
        const response = await this.getWiki().request<T>(params as RequestParams, method);
        assertNoMediaWikiError(response, String(params.action ?? 'MediaWiki request'));
        return response;
    }

    safeError(error: unknown): { code: string; message: string } {
        const externalCode = optionalString(record(error).code);
        const code =
            error instanceof McpOperationError
                ? error.code
                : externalCode ?? 'huijiwiki-error';
        const message = error instanceof Error ? error.message : String(error);
        return {
            code,
            message: redactSecrets(message, [
                this.env.HUIJI_AUTHKEY,
                this.env.HUIJI_BOT_PASSWORD,
            ]),
        };
    }

    async whoAmI() {
        const config = this.getConfig();
        if (config.botUsername && config.botPassword) {
            await this.getAuthenticatedWiki();
        }
        const queryUserInfo = async () => {
            const response = await this.request<JsonRecord & MWResponseBase>({
                action: 'query',
                meta: 'userinfo',
                uiprop: 'rights|groups',
                formatversion: 2,
            });
            return record(record(response.query).userinfo);
        };
        let userInfo = await queryUserInfo();
        let id = optionalNumber(userInfo.id) ?? 0;
        let username = typeof userInfo.name === 'string' ? userInfo.name : '';
        if (config.botUsername && config.botPassword && (id <= 0 || username === '*')) {
            await this.getAuthenticatedWiki(true);
            userInfo = await queryUserInfo();
            id = optionalNumber(userInfo.id) ?? 0;
            username = typeof userInfo.name === 'string' ? userInfo.name : '';
        }
        return {
            username,
            id,
            groups: array(userInfo.groups).filter((item): item is string => typeof item === 'string'),
            rights: array(userInfo.rights).filter((item): item is string => typeof item === 'string'),
            loggedIn: id > 0 && username !== '*',
        };
    }

    async getSiteInfo() {
        const response = await this.request<JsonRecord & MWResponseBase>({
            action: 'query',
            meta: 'siteinfo',
            siprop: 'general|namespaces|namespacealiases',
            formatversion: 2,
        });
        const query = record(response.query);
        return {
            general: query.general ?? {},
            namespaces: query.namespaces ?? {},
            namespacealiases: query.namespacealiases ?? [],
        };
    }

    async getPage(title: string): Promise<PageRevision> {
        const pages = await this.getPages([validateTitle(title)]);
        if (pages.length === 0) {
            throw new McpOperationError('missingtitle', `Page not found: ${title}`);
        }
        return pages[0];
    }

    async getPages(titles: string[]): Promise<PageRevision[]> {
        if (titles.length === 0 || titles.length > 50) {
            throw new McpOperationError('invalid-input', 'titles must contain between 1 and 50 items.');
        }
        const normalizedTitles = titles.map(validateTitle);
        const response = await this.request<JsonRecord & MWResponseBase>({
            action: 'query',
            titles: normalizedTitles.join('|'),
            prop: 'revisions',
            rvprop: 'ids|timestamp|content|contentmodel',
            rvslots: 'main',
            formatversion: 2,
        });
        return normalizePagesResponse(response);
    }

    async searchPages(query: string, namespace?: number, limit = 20, continueToken?: string) {
        const response = await this.request<JsonRecord & MWResponseBase>({
            action: 'query',
            list: 'search',
            srsearch: query,
            srlimit: limit,
            ...(namespace !== undefined ? { srnamespace: namespace } : {}),
            ...decodeContinuation(continueToken, 'srcontinue'),
            formatversion: 2,
        });
        return {
            results: array(record(response.query).search),
            continueToken: encodeContinuation(response, 'srcontinue'),
        };
    }

    async getLinks(title: string, namespace?: number, limit = 100, continueToken?: string) {
        const response = await this.request<JsonRecord & MWResponseBase>({
            action: 'query',
            prop: 'links',
            titles: validateTitle(title),
            pllimit: limit,
            ...(namespace !== undefined ? { plnamespace: namespace } : {}),
            ...decodeContinuation(continueToken, 'plcontinue'),
            formatversion: 2,
        });
        const page = pageValues(response)[0] ?? {};
        if (Object.prototype.hasOwnProperty.call(page, 'missing')) {
            throw new McpOperationError('missingtitle', `Page not found: ${title}`);
        }
        return {
            links: array(page.links),
            continueToken: encodeContinuation(response, 'plcontinue'),
        };
    }

    async getBacklinks(title: string, namespace?: number, limit = 100, continueToken?: string) {
        const response = await this.request<JsonRecord & MWResponseBase>({
            action: 'query',
            list: 'backlinks',
            bltitle: validateTitle(title),
            bllimit: limit,
            ...(namespace !== undefined ? { blnamespace: namespace } : {}),
            ...decodeContinuation(continueToken, 'blcontinue'),
            formatversion: 2,
        });
        return {
            pages: array(record(response.query).backlinks),
            continueToken: encodeContinuation(response, 'blcontinue'),
        };
    }

    async getTransclusions(
        title: string,
        namespace?: number,
        limit = 100,
        continueToken?: string
    ) {
        const response = await this.request<JsonRecord & MWResponseBase>({
            action: 'query',
            list: 'embeddedin',
            eititle: validateTitle(title),
            eilimit: limit,
            ...(namespace !== undefined ? { einamespace: namespace } : {}),
            ...decodeContinuation(continueToken, 'eicontinue'),
            formatversion: 2,
        });
        return {
            pages: array(record(response.query).embeddedin),
            continueToken: encodeContinuation(response, 'eicontinue'),
        };
    }

    async parseWikitext(text: string, title?: string) {
        const response = await this.request<JsonRecord & MWResponseBase>(
            {
                action: 'parse',
                text,
                ...(title ? { title: validateTitle(title) } : {}),
                prop: 'text|links|templates|categories|properties|modules|modulestyles|jsconfigvars',
                formatversion: 2,
            },
            'POST'
        );
        const parsed = record(response.parse);
        const rendered = parsed.text;
        return {
            title: optionalString(parsed.title),
            renderedHtml:
                typeof rendered === 'string' ? rendered : optionalString(record(rendered)['*']) ?? '',
            links: array(parsed.links),
            templates: array(parsed.templates),
            categories: array(parsed.categories),
            properties: array(parsed.properties),
            modules: array(parsed.modules),
            modulestyles: array(parsed.modulestyles),
            jsconfigvars: record(parsed.jsconfigvars),
            warnings: response.warnings ?? {},
        };
    }

    private async getCompareParameters(): Promise<Set<string>> {
        if (this.compareParameters) {
            return this.compareParameters;
        }
        const response = await this.request<JsonRecord & MWResponseBase>({
            action: 'paraminfo',
            modules: 'compare',
            formatversion: 2,
        });
        const module = record(array(record(response.paraminfo).modules)[0]);
        const parameters = new Set(
            array(module.parameters)
                .map((parameter) => optionalString(record(parameter).name))
                .filter((name): name is string => Boolean(name))
        );
        if (!parameters.has('fromrev') || !parameters.has('totext')) {
            throw new McpOperationError(
                'compare-unsupported',
                'This wiki does not advertise compare support for fromrev and totext.'
            );
        }
        this.compareParameters = parameters;
        return parameters;
    }

    async compare(title: string, candidateText: string) {
        const page = await this.getPage(title);
        if (page.missing || page.revid === null || page.timestamp === null) {
            throw new McpOperationError('missingtitle', `Page not found: ${title}`);
        }
        await this.getCompareParameters();
        const response = await this.request<JsonRecord & MWResponseBase>(
            {
                action: 'compare',
                fromrev: page.revid,
                totext: candidateText,
                prop: 'diff|ids|title',
                formatversion: 2,
            },
            'POST'
        );
        const comparison = record(response.compare);
        return {
            title: page.title,
            baseRevId: page.revid,
            baseTimestamp: page.timestamp,
            diff:
                optionalString(comparison.body) ?? optionalString(comparison['*']) ?? '',
        };
    }

    private editResult(response: MWResponseEdit, operation: string) {
        assertNoMediaWikiError(response, operation);
        if (!response.edit) {
            throw new McpOperationError('invalid-response', `${operation} returned no edit result.`);
        }
        return {
            title: response.edit.title,
            pageid: response.edit.pageid,
            oldrevid: response.edit.oldrevid,
            newrevid: response.edit.newrevid,
            result: response.edit.result,
        };
    }

    async updatePage(input: {
        title: string;
        text: string;
        expectedRevId: number;
        summary: string;
        minor?: boolean;
    }) {
        const title = validateTitle(input.title);
        const summary = validateSummary(input.summary);
        if (!Number.isInteger(input.expectedRevId) || input.expectedRevId <= 0) {
            throw new McpOperationError('invalid-input', 'expectedRevId must be a positive integer.');
        }
        const wiki = await this.getAuthenticatedWiki();
        const response = await wiki.editPage(title, input.text, {
            baseRevId: input.expectedRevId,
            noCreate: true,
            isBot: true,
            summary,
            minor: input.minor,
        });
        return this.editResult(response, 'update_page');
    }

    async createPage(input: { title: string; text: string; summary: string; minor?: boolean }) {
        const title = validateTitle(input.title);
        const summary = validateSummary(input.summary);
        const wiki = await this.getAuthenticatedWiki();
        const response = await wiki.editPage(title, input.text, {
            createOnly: true,
            isBot: true,
            summary,
            minor: input.minor,
        });
        return this.editResult(response, 'create_page');
    }

    async purge(titles: string[]) {
        if (titles.length === 0 || titles.length > 50) {
            throw new McpOperationError('invalid-input', 'titles must contain between 1 and 50 items.');
        }
        const normalizedTitles = titles.map(validateTitle);
        const wiki = await this.getAuthenticatedWiki();
        const response = await wiki.request<JsonRecord & MWResponseBase>(
            {
                action: 'purge',
                titles: normalizedTitles.join('|'),
                formatversion: 2,
            },
            'POST'
        );
        assertNoMediaWikiError(response, 'purge');
        return { pages: array(response.purge) };
    }
}
