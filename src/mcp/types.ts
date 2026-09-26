import type { EditOptions, HuijiWiki } from '../HuijiWiki/HuijiWiki';
import type { RequestParams } from '../HuijiWiki/HuijiRequester';
import type { MWResponseBase, MWResponseEdit } from '../HuijiWiki/typeMWApiResponse';

export interface McpConfig {
    prefix: string;
    authKey: string;
    botUsername?: string;
    botPassword?: string;
    userAgent: string;
}

export interface PageRevision {
    title: string;
    pageid: number | null;
    namespace: number;
    missing: boolean;
    revid: number | null;
    parentid: number | null;
    timestamp: string | null;
    contentmodel: string | null;
    content: string | null;
}

export interface WikiClient {
    request<T extends MWResponseBase = MWResponseBase>(
        params: RequestParams,
        method?: 'GET' | 'POST'
    ): Promise<T>;
    apiLogin(username: string, password: string): Promise<boolean>;
    editPage(title: string, text: string, options?: EditOptions): Promise<MWResponseEdit>;
    setUserAgent(userAgent: string): void;
    getLastErrorMessage(): string;
}

export type WikiFactory = (prefix: string, authKey: string) => HuijiWiki | WikiClient;
