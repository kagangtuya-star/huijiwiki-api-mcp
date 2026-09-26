import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import FormData from 'form-data';
import { HuijiCookies } from './HuijiCookie';
import { MWResponseBase, MWResponseUpload } from './typeMWApiResponse';

export type RequestParams = { action: string; method?: 'GET' | 'POST' } & Record<string, any>;

type HttpClient = Pick<AxiosInstance, 'request'>;

export class HuijiRequestError extends Error {
    constructor(
        message: string,
        public readonly status?: number,
        public readonly code = 'http-error'
    ) {
        super(message);
        this.name = 'HuijiRequestError';
    }
}

export class HuijiRequester {
    private apiUrl: string;
    private cookie: HuijiCookies;
    private headers: Record<string, string>;
    private userAgent: string = 'Huiji bot/0.0.1';
    private httpClient: HttpClient;
    private secrets: string[];

    /** 请求计数器 */
    private reqIndex: number = 0;

    private lastResult: any;
    private maxRetryCount = 3;

    constructor(prefix: string, authKey: string, options?: { httpClient?: HttpClient }) {
        this.apiUrl = `https://${prefix}.huijiwiki.com/api.php`;
        this.cookie = new HuijiCookies();
        this.httpClient = options?.httpClient ?? axios;
        this.secrets = [authKey].filter(Boolean);
        this.headers = {
            'X-authkey': authKey,
        };
    }

    static getMethod(params: RequestParams) {
        if (params.method) {
            return params.method;
        }
        if (params.action === 'query') {
            return 'GET';
        }
        if (params.action === 'parse' && !params.text) {
            return 'GET';
        }
        return 'POST';
    }

    setMaxRetryCount(count: number) {
        this.maxRetryCount = count;
    }

    setUserAgent(userAgent: string) {
        this.userAgent = userAgent;
    }

    async get<T extends MWResponseBase = MWResponseBase>(params: RequestParams): Promise<T> {
        return await this.request(params, 'GET');
    }

    async post<T extends MWResponseBase = MWResponseBase>(params: RequestParams): Promise<T> {
        return await this.request(params, 'POST');
    }

    async request<T extends MWResponseBase = MWResponseBase>(
        params: RequestParams,
        method?: 'GET' | 'POST'
    ): Promise<T> {
        this.reqIndex++;
        const requestParams = { ...params, format: 'json', utf8: '1' };
        if (!method) {
            method = HuijiRequester.getMethod(requestParams);
        }
        return await this.execute<T>(requestParams, method, 0);
    }

    private async execute<T extends MWResponseBase = MWResponseBase>(
        params: RequestParams,
        method: 'GET' | 'POST',
        retryCount: number
    ): Promise<T> {
        let res: AxiosResponse<T>;
        try {
            res = method === 'GET' ? await this.handleGet<T>(params) : await this.handlePost<T>(params);
        } catch (error) {
            if (
                retryCount < this.maxRetryCount &&
                this.isRetryableRequest(params) &&
                this.isTransientNetworkError(error)
            ) {
                await sleep(250 * 2 ** retryCount);
                return await this.execute<T>(params, method, retryCount + 1);
            }
            throw new HuijiRequestError(
                `Huiji Wiki request failed: ${this.sanitizeMessage(
                    error instanceof Error ? error.message : String(error)
                )}`,
                undefined,
                'network-error'
            );
        }

        if (res.status >= 200 && res.status < 300) {
            this.cookie.setCookies(res.headers['set-cookie'] || []);
            this.lastResult = res.data;
            return this.lastResult;
        }

        if (
            this.isRetryableRequest(params) &&
            this.isRetryableStatus(res.status) &&
            retryCount < this.maxRetryCount
        ) {
            await sleep(250 * 2 ** retryCount);
            return await this.execute<T>(params, method, retryCount + 1);
        }

        throw this.createHttpError(res);
    }

    private async handleGet<T = MWResponseBase>(params: RequestParams) {
        return await this.httpClient.request<T>({
            url: this.apiUrl + '?' + new URLSearchParams(params),
            method: 'GET',
            headers: {
                ...this.headers,
                'User-Agent': this.userAgent,
                cookie: this.cookie.getCookies(),
            },
            validateStatus: () => true,
        });
    }

    private async handlePost<T = MWResponseBase>(params: RequestParams) {
        if (params.action === 'upload') {
            return await this.handleUpload<T>(params);
        }
        return await this.httpClient.request<T>({
            url: this.apiUrl,
            method: 'POST',
            data: new URLSearchParams(params),
            headers: {
                ...this.headers,
                'User-Agent': this.userAgent,
                cookie: this.cookie.getCookies(),
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            validateStatus: () => true,
        });
    }

    private async handleUpload<T = MWResponseUpload>(params: RequestParams) {
        const formData = new FormData();
        for (const key in params) {
            if (key === 'file') {
                formData.append(key, params[key], params.filename);
            } else {
                formData.append(key, params[key]);
            }
        }
        return await this.httpClient.request<T>({
            url: this.apiUrl,
            method: 'POST',
            data: formData,
            headers: {
                ...this.headers,
                'User-Agent': this.userAgent,
                cookie: this.cookie.getCookies(),
                'Content-Type': 'multipart/form-data',
            },
            validateStatus: () => true,
        });
    }

    private isRetryableStatus(status: number) {
        return status === 429 || status >= 500;
    }

    private isRetryableRequest(params: RequestParams) {
        return ['query', 'parse', 'compare', 'paraminfo', 'ask', 'purge'].includes(params.action);
    }

    private isTransientNetworkError(error: unknown) {
        if (!axios.isAxiosError(error)) {
            return false;
        }
        return ['ECONNABORTED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(error.code ?? '');
    }

    private createHttpError<T>(response: AxiosResponse<T>) {
        const contentType = String(response.headers['content-type'] ?? 'unknown').split(';')[0];
        const body = response.data;
        const bodyText = typeof body === 'string' ? body : '';
        const isHtml = contentType.includes('text/html') || /^\s*<!doctype html/i.test(bodyText);
        const isCloudflare =
            isHtml && /cloudflare|cf-ray|challenge-platform|just a moment/i.test(bodyText);

        if (response.status === 403 && isCloudflare) {
            return new HuijiRequestError(
                'HTTP 403 (text/html): Cloudflare challenge detected; check HUIJI_AUTHKEY or Huiji Wiki API permissions.',
                response.status,
                'cloudflare-challenge'
            );
        }

        let detail = '';
        if (!isHtml && body && typeof body === 'object') {
            const error = (body as { error?: { code?: string; info?: string } }).error;
            if (error?.code) {
                detail = `; MediaWiki error ${error.code}${error.info ? `: ${error.info}` : ''}`;
            }
        } else if (!isHtml && bodyText) {
            detail = `; body: ${bodyText.replace(/\s+/g, ' ').trim().slice(0, 160)}`;
        }

        return new HuijiRequestError(
            this.sanitizeMessage(`HTTP ${response.status} (${contentType})${detail}`),
            response.status,
            `http-${response.status}`
        );
    }

    private sanitizeMessage(message: string) {
        return this.secrets.reduce(
            (safeMessage, secret) => safeMessage.split(secret).join('[REDACTED]'),
            message
        );
    }

    getLastResult() {
        return this.lastResult;
    }

    hasHuijiSession(): boolean {
        return this.cookie.hasCookie('huiji_session');
    }
}

const sleep = async (ms: number) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
};
