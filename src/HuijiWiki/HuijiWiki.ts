import { readFileSync } from 'fs';
import { HuijiRequester, type RequestParams } from './HuijiRequester';
import { HuijiwikiMemoryCache, type IHuijiwikiCache } from './HuijiwikiMemoryCache';
import type {
    MWPage,
    MWResponseAsk,
    MWResponseBase,
    MWResponseClientLogin,
    MWResponseDelete,
    MWResponseEdit,
    MWResponseLogin,
    MWResponseMove,
    MWResponsePurge,
    MWResponseQueryListAllPages,
    MWResponseQueryListAllRedirects,
    MWResponseQueryListCategoryMembers,
    MWResponseQueryMetaSiteInfo,
    MWResponseQueryPropRevisions,
    MWResponseQueryTokens,
    MWResponseUndelete,
    MWResponseUpload,
} from './typeMWApiResponse';

export enum LOG_LEVEL {
    INFO = 10,
    WARN = 20,
    ERROR = 30,
    NONE = 1000,
}

export interface EditOptions {
    isBot?: boolean;
    summary?: string;
    baseRevId?: number;
    createOnly?: boolean;
    noCreate?: boolean;
    minor?: boolean;
}

export class HuijiWiki {
    private prefix: string;
    private csrfToken: string = '';
    /** 登录的用户名，可供显示 */
    private username: string = '';
    private lastError: string = '';

    /** 登录用的用户名缓存 */
    private loginUsername: string = '';
    /** 登录用的密码缓存 */
    private loginPassword: string = '';

    private logLevel: LOG_LEVEL;

    // 状态标记
    private requeryToken: boolean = false;

    /// 内置对象
    /** 请求器 */
    private requester: HuijiRequester;
    /** 本地缓存 */
    public localCache: IHuijiwikiCache;

    constructor(
        prefix: string,
        authKey: string,
        { cache, logLevel }: { cache?: IHuijiwikiCache; logLevel?: LOG_LEVEL } = {}
    ) {
        this.prefix = prefix;
        this.requester = new HuijiRequester(prefix, authKey);
        this.localCache = cache ? cache : new HuijiwikiMemoryCache();
        this.logLevel = logLevel ?? LOG_LEVEL.NONE;
    }

    // ------------------------------------------------
    // -- 基础方法
    // ------------------------------------------------

    log(msg: string, level: LOG_LEVEL = LOG_LEVEL.INFO) {
        if (level < this.logLevel) {
            return;
        }
        switch (level) {
            case LOG_LEVEL.INFO:
                console.log(msg);
                break;
            case LOG_LEVEL.WARN:
                console.warn(msg);
                break;
            case LOG_LEVEL.ERROR:
                this.lastError = msg;
                console.error(msg);
                break;
            default:
                console.log(msg);
                break;
        }
    }

    warn(msg: string) {
        this.log(msg, LOG_LEVEL.WARN);
    }

    error(msg: string) {
        this.log(msg, LOG_LEVEL.ERROR);
    }

    getLastErrorMessage() {
        return this.lastError;
    }

    setUserAgent(userAgent: string) {
        this.requester.setUserAgent(userAgent);
    }

    setLogLevel(level: LOG_LEVEL) {
        this.logLevel = level;
    }

    compareContent(pageTitle: string, content: string) {
        return this.localCache.compare(pageTitle, content);
    }

    // ------------------------------------------------
    // -- 自定义请求
    // ------------------------------------------------

    /**
     * 自定义请求
     * @param params 请求参数
     * @param method 请求方法
     */
    async request<T extends MWResponseBase = MWResponseBase>(
        params: RequestParams,
        method?: 'GET' | 'POST'
    ): Promise<T> {
        return await this.requester.request<T>(params, method);
    }

    /**
     * 自定义GET请求
     * @param params 请求参数
     */
    async get<T extends MWResponseBase = MWResponseBase>(params: RequestParams) {
        return await this.requester.get<T>(params);
    }

    /**
     * 自定义POST请求
     * @param params 请求参数
     */
    async post<T extends MWResponseBase = MWResponseBase>(params: RequestParams) {
        return await this.requester.post<T>(params);
    }

    // ------------------------------------------------
    // -- API 请求方法
    // ------------------------------------------------

    /**
     * 登录WIKI
     * @param username 用户名
     * @param password 密码
     * @returns 是否登录成功
     */
    async apiLogin(username: string, password: string) {
        username = username.trim();
        password = password.trim();
        if (username.indexOf('@') === -1) {
            return await this.clientlogin(username, password);
        } else {
            return await this.login(username, password);
        }
    }

    private async clientlogin(
        username: string,
        password: string,
        bootstrapAttempted = false
    ): Promise<boolean> {
        let loginToken = '';
        {
            const resToken = await this.requester.request<MWResponseQueryTokens>({
                action: 'query',
                meta: 'tokens',
                type: 'login',
            });
            loginToken = resToken.query.tokens.logintoken;
        }
        // 检查是否有huiji_session，如果没有则额外执行一次登录
        if (!this.requester.hasHuijiSession()) {
            if (bootstrapAttempted) {
                this.error('登录失败：无法建立 huiji_session');
                return false;
            }
            await this.requester.request<MWResponseClientLogin>({
                action: 'clientlogin',
                username: username,
                password: password,
                logintoken: '+\\',
                loginreturnurl: `https://${this.prefix}.huijiwiki.com`,
                rememberMe: '1',
            });
            return this.clientlogin(username, password, true);
        }
        const resLogin = await this.requester.request<MWResponseClientLogin>({
            action: 'clientlogin',
            username: username,
            password: password,
            logintoken: loginToken,
            loginreturnurl: `https://${this.prefix}.huijiwiki.com`,
            rememberMe: '1',
        });
        // console.log('API响应:', resLogin);
        if (resLogin.clientlogin.status === 'PASS') {
            this.username = resLogin.clientlogin.username;
            // 记录下以备后续重新登录用
            this.loginUsername = username;
            this.loginPassword = password;
            this.log(`登录成功，用户名：${this.username}`);
            return true;
        } else {
            this.error(`登录失败，错误信息：${resLogin.clientlogin.message}`);
            return false;
        }
    }

    private async login(username: string, password: string) {
        let lgtoken = '';
        {
            const resLogin = await this.requester.request<MWResponseLogin>({
                action: 'login',
                lgname: username,
                lgpassword: password,
            });

            if (resLogin.login.result === 'NeedToken') {
                lgtoken = resLogin.login.token;
            }
        }

        if (lgtoken === '') {
            this.error(`登录失败，无法获取登录Token`);
            return false;
        }

        {
            const resLogin = await this.requester.request<MWResponseLogin>({
                action: 'login',
                lgname: username,
                lgpassword: password,
                lgtoken,
            });

            if (resLogin.login.result === 'Success') {
                this.username = resLogin.login.lgusername;
                // 记录下以备后续重新登录用
                this.loginUsername = username;
                this.loginPassword = password;
                this.log(`登录成功，用户名：${this.username}`);
                return true;
            } else if (resLogin.login.result === 'Failed') {
                this.error(`登录失败，错误信息：${resLogin.login.reason}`);
                return false;
            } else {
                this.error(`登录失败，未知错误`);
                return false;
            }
        }
    }

    /**
     * 获取CSRF Token
     * @returns CSRF Token
     */
    async apiQueryCsrfToken(): Promise<string> {
        if (this.csrfToken !== '') {
            return this.csrfToken;
        }
        const res = await this.requester.request<MWResponseQueryTokens>({
            action: 'query',
            meta: 'tokens',
        });
        this.csrfToken = res.query.tokens.csrftoken;
        if (this.csrfToken === '+\\') {
            this.csrfToken = '';
            // 尝试重新登录
            if (this.loginUsername !== '' && this.loginPassword !== '') {
                if (await this.apiLogin(this.loginUsername, this.loginPassword)) {
                    return await this.apiQueryCsrfToken();
                } else {
                    this.loginUsername = '';
                    this.loginPassword = '';
                    this.error('获取 CSRF Token 失败，且尝试重新登录失败');
                }
            } else {
                this.error('获取 CSRF Token 失败：因为没有登录');
            }
        }
        return this.csrfToken;
    }

    resultCsrfTokenMissing<T extends MWResponseBase = MWResponseBase>() {
        return {
            error: {
                code: 'csrf-token-missing',
                info: 'CSRF Token 为空',
            },
        } as T;
    }

    async requestWithCsrfToken<T extends MWResponseBase = MWResponseBase>(
        queryFunc: (csrfToken: string) => Promise<T>,
        badTokenRetries = 1
    ): Promise<T> {
        const csrfToken = await this.apiQueryCsrfToken();
        if (csrfToken === '') {
            return this.resultCsrfTokenMissing<T>();
        }

        const res = await queryFunc(csrfToken);

        if (res.error && res.error.code === 'badtoken' && badTokenRetries > 0) {
            if (!this.requeryToken) {
                this.requeryToken = true;
                this.csrfToken = '';
                await this.apiQueryCsrfToken();
                this.requeryToken = false;
            } else {
                await sleep(1000);
            }
            return await this.requestWithCsrfToken(queryFunc, badTokenRetries - 1);
        }

        return res;
    }

    /**
     * Edit API
     * @param title 条目标题
     * @param text 条目内容
     * @param options 选项
     * @param options.isBot 是否为机器人编辑，默认为true
     * @param options.summary 编辑摘要，默认为'Huiji Bot 编辑'
     * @returns API 返回值
     */
    async apiEdit(
        title: string,
        text: string,
        options?: EditOptions
    ): Promise<MWResponseEdit> {
        options = options || {};
        const isBot = options.isBot ?? true;
        const summary = options.summary ?? 'Huiji Bot 编辑';

        const queryFunc = async (csrfToken: string) => {
            return await this.requester.request<MWResponseEdit>({
                action: 'edit',
                title: title,
                text: text,
                summary: summary,
                token: csrfToken,
                ...(isBot ? { bot: '1' } : {}),
                ...(options?.baseRevId !== undefined ? { baserevid: options.baseRevId } : {}),
                ...(options?.createOnly ? { createonly: '1' } : {}),
                ...(options?.noCreate ? { nocreate: '1' } : {}),
                ...(options?.minor ? { minor: '1' } : {}),
            });
        };

        const res = await this.requestWithCsrfToken(queryFunc);
        if (!res.error) {
            await this.localCache.set(title, text);
        }
        return res;
    }

    /**
     * Query > List > AllPages API
     * @param filter 需要查询的条件
     * @param options 选项
     * @returns API 返回值
     */
    async apiQueryListAllPages(
        filter?: {
            namespace?: number;
            prefix?: string;
            // 以后需要别的再加
        },
        options?: { limit?: number; continue?: string }
    ) {
        options = options || {};
        const limit = options.limit ?? 500;
        const finalFilter = {} as { [key: string]: string | number };
        if (filter?.namespace !== undefined) {
            finalFilter['apnamespace'] = filter.namespace;
        }
        if (filter?.prefix !== undefined) {
            finalFilter['apprefix'] = filter.prefix;
        }

        return await this.requester.request<MWResponseQueryListAllPages>({
            action: 'query',
            list: 'allpages',
            ...finalFilter,
            aplimit: limit,
            ...(options.continue ? { apcontinue: options.continue } : {}),
        });
    }

    /**
     * Query > List > CategoryMembers API
     * @param filter 需要查询的条件
     * @param options 选项
     * @returns API 返回值
     */
    async apiQueryListCategoryMembers(
        filter?: {
            category?: string;
        },
        options?: { limit?: number; continue?: string }
    ) {
        options = options || {};
        const limit = options.limit ?? 500;
        const finalFilter = {} as { [key: string]: string | number };
        if (filter?.category !== undefined) {
            finalFilter['cmtitle'] = `Category:${filter.category}`;
        }

        return await this.requester.request<MWResponseQueryListCategoryMembers>({
            action: 'query',
            list: 'categorymembers',
            ...finalFilter,
            cmlimit: limit,
            ...(options.continue ? { cmcontinue: options.continue } : {}),
        });
    }

    /**
     * Query > List > AllRedirects API
     * @param filter 查询条件
     * @param options 选项
     * @returns API 返回值
     */
    async apiQueryListAllRedirects(
        filter?: {
            namespace?: number;
        },
        options?: { limit?: number; continue?: string }
    ) {
        options = options || {};
        const finalFilter = {} as { [key: string]: string | number };
        if (filter?.namespace !== undefined) {
            finalFilter['arnamespace'] = filter.namespace;
        }

        return await this.requester.request<MWResponseQueryListAllRedirects>({
            action: 'query',
            list: 'allredirects',
            ...finalFilter,
            arlimit: options.limit ?? 500,
            arprop: 'ids|title',
            ...(options.continue ? { arcontinue: options.continue } : {}),
        });
    }

    /**
     * Query > Prop > Revisions API
     * @param titles 条目标题列表
     * @returns API 返回值
     */
    async apiQueryPropRevisions(filter: { titles?: string[]; pageids?: number[] }) {
        const titles = filter.titles ?? [];
        const pageids = filter.pageids ?? [];
        let finalFilter = {} as { [key: string]: string | number };
        if (titles.length > 0) {
            finalFilter['titles'] = titles.join('|');
        } else if (pageids.length > 0) {
            finalFilter['pageids'] = pageids.join('|');
        } else {
            return {
                error: {
                    code: 'no-title-or-id',
                    info: '没有提供标题或ID',
                },
            } as MWResponseQueryPropRevisions;
        }

        return await this.requester.request<MWResponseQueryPropRevisions>({
            action: 'query',
            ...finalFilter,
            prop: 'revisions',
            rvprop: 'content',
            rvslots: 'main',
        });
    }

    /**
     * Query > Meta > SiteInfo API
     * @param props
     * @returns
     */
    async apiQueryMetaSiteInfo(props?: string[]) {
        props = props || ['general'];
        return await this.requester.request<MWResponseQueryMetaSiteInfo>({
            action: 'query',
            meta: 'siteinfo',
            siprop: props.join('|'),
        });
    }

    /**
     * Ask API
     * @param query 查询语句
     * @returns API 返回值
     */
    async apiAsk(query: string) {
        return await this.requester.request<MWResponseAsk>({
            action: 'ask',
            query: query,
            api_version: '3',
        });
    }

    /**
     * upload API
     * @param file 上传的文件Buffer
     * @param filename 上传的文件名
     * @param options 选项
     * @returns API 返回值
     */
    async apiUpload(
        file: Buffer,
        filename: string,
        options?: { comment?: string; text?: string }
    ): Promise<MWResponseUpload> {
        const queryFunc = async (csrfToken: string) => {
            return await this.requester.request<MWResponseUpload>({
                action: 'upload',
                filename: filename,
                token: csrfToken,
                ignorewarnings: '1',
                comment: options?.comment ?? '',
                text: options?.text ?? '',
                file: file,
            });
        };

        const res = await this.requestWithCsrfToken(queryFunc);
        return res;
    }

    /**
     * delete API
     * @param title 要删除条目的标题
     * @param reason 删除理由
     * @returns API 返回值
     */
    async apiDelete(title: string, reason?: string) {
        const queryFunc = async (csrfToken: string) => {
            return await this.requester.request<MWResponseDelete>({
                action: 'delete',
                title: title,
                token: csrfToken,
                reason: reason ?? '',
            });
        };

        const res = await this.requestWithCsrfToken(queryFunc);
        if (!res.error) {
            await this.localCache.delete(title);
        }
        return res;
    }

    /**
     * Undelete API
     * @param title 要恢复删除的条目标题
     * @param reason 恢复理由
     * @returns API 返回值
     */
    async apiUndelete(title: string, reason?: string) {
        const queryFunc = async (csrfToken: string) => {
            return await this.requester.request<MWResponseUndelete>({
                action: 'undelete',
                title: title,
                token: csrfToken,
                reason: reason ?? '',
            });
        };

        return await this.requestWithCsrfToken(queryFunc);
    }

    /**
     * Purge API
     * @param filter 需要清理的条目
     * @returns API 返回值
     */
    async apiPurge(filter: { titles?: string[]; pageids?: number[] }) {
        const titles = filter.titles ?? [];
        const pageids = filter.pageids ?? [];
        let finalFilter = {} as { [key: string]: string | number };
        if (titles.length > 0) {
            finalFilter['titles'] = titles.join('|');
        } else if (pageids.length > 0) {
            finalFilter['pageids'] = pageids.join('|');
        } else {
            return {
                error: {
                    code: 'no-title-or-id',
                    info: '没有提供标题或ID',
                },
            } as MWResponsePurge;
        }

        return await this.requester.request<MWResponsePurge>({
            action: 'purge',
            ...finalFilter,
            forcerecursivelinkupdate: '1',
        });
    }

    /**
     * Move API
     * @param from 原始条目标题
     * @param to 目标条目标题
     * @param options 选项
     * @returns API 返回值
     */
    async apiMove(
        from: string,
        to: string,
        options?: {
            reason?: string;
            movetalk?: boolean;
            movesubpages?: boolean;
            noredirect?: boolean;
        }
    ) {
        const finalOptions = {} as { [key: string]: string };
        options?.movetalk && (finalOptions.movetalk = '1');
        options?.movesubpages && (finalOptions.movesubpages = '1');
        options?.noredirect && (finalOptions.noredirect = '1');

        const queryFunc = async (csrfToken: string) => {
            return await this.requester.request<MWResponseMove>({
                action: 'move',
                from: from,
                to: to,
                token: csrfToken,
                reason: options?.reason ?? '',
                ...finalOptions,
                ignorewarnings: '1',
            });
        };

        const res = await this.requestWithCsrfToken(queryFunc);
        if (!res.error) {
            await this.localCache.rename(from, to);
        }
        return res;
    }

    // ------------------------------------------------
    // -- WIKI 操作用方法：查询类
    // ------------------------------------------------

    /**
     * 通过命名空间ID查询条目
     * @param namespace 命名空间ID
     * @param options 选项
     * @returns 查询结果
     */
    async getPageListByNamespace(namespace: number, options?: { limit?: number; continue?: string }) {
        const res = await this.apiQueryListAllPages({ namespace: namespace }, options);
        return {
            pages: res.query.allpages,
            continue: res.continue?.apcontinue ?? '',
        };
    }

    /**
     * 通过分类名查询条目
     * @param category 分类名称
     * @param options 选项
     * @returns 查询结果
     */
    async getPageListByCategory(category: string, options?: { limit?: number; continue?: string }) {
        const res = await this.apiQueryListCategoryMembers({ category: category }, options);
        return {
            pages: res.query.categorymembers,
            continue: res.continue?.cmcontinue ?? '',
        };
    }

    /**
     * 通过SMW查询条目
     * @param query 查询语句
     * @param options 选项
     * @returns 查询结果
     */
    async getPageListBySMW(query: string, options?: { limit?: number; offset?: number }) {
        const queryArray = [query];
        queryArray.push(`limit=${options?.limit ?? 500}`);
        queryArray.push(`offset=${options?.offset ?? 0}`);

        const res = await this.apiAsk(queryArray.join('|'));
        const pageList = [] as MWPage[];
        for (const pageInfoTop of res.query.results) {
            for (const pageName in pageInfoTop) {
                const pageInfo = pageInfoTop[pageName];
                pageList.push({
                    pageid: -1,
                    title: pageInfo.fulltext,
                    ns: pageInfo.namespace,
                });
            }
        }
        return {
            pages: pageList,
            continue: res['query-continue-offset'] ?? -1,
        };
    }

    async cleanQueryPropRevisionsResult(data: MWResponseQueryPropRevisions, useId = false) {
        const pageTextList = {} as {
            [title: string]: {
                pageId: number;
                pageTitle: string;
                content: string;
                contentmodel: string;
            };
        };
        if (!data.error) {
            for (const pageId in data.query.pages) {
                const page = data.query.pages[pageId];
                if (page.missing !== undefined || page.invalid !== undefined) {
                    continue;
                }
                const key = useId ? page.pageid : page.title;

                pageTextList[key] = {
                    pageId: page.pageid,
                    pageTitle: page.title,
                    content: page.revisions[0].slots.main['*'],
                    contentmodel: page.revisions[0].slots.main.contentmodel,
                };
                await this.localCache.set(page.title, page.revisions[0].slots.main['*']);
            }
        }
        return pageTextList;
    }

    async getPageRawTextByTitles(titles: string[]) {
        const res = await this.apiQueryPropRevisions({ titles: titles });
        return this.cleanQueryPropRevisionsResult(res);
    }

    async getPageRawTextByTitle(title: string) {
        const res = await this.getPageRawTextByTitles([title]);
        if (res[title]) {
            return res[title];
        } else if (Object.keys(res).length > 0) {
            return res[Object.keys(res)[0]];
        } else {
            return undefined;
        }
    }

    async getPageRawTextByPageIds(pageIds: number[]) {
        const res = await this.apiQueryPropRevisions({ pageids: pageIds });
        return this.cleanQueryPropRevisionsResult(res, true);
    }

    async getPageRawTextByPageId(pageId: number) {
        const res = await this.getPageRawTextByPageIds([pageId]);
        return res[pageId];
    }

    /**
     * 包装后的查询所有重定向方法
     * @param namespace 需要查询的命名空间，默认为-1（全部）
     * @returns 查询结果
     */
    async getAllRedirects(namespace?: number, options?: { limit?: number; continue?: string }) {
        const filter = {} as { [key: string]: number };
        namespace = namespace ?? -1;
        if (namespace > -1) {
            filter['namespace'] = namespace;
        }
        return await this.apiQueryListAllRedirects({ ...filter }, options);
    }

    /**
     * 获取站点基础信息，也包括命名空间数据
     * @returns API 返回值
     */
    async getSiteInfo() {
        return await this.apiQueryMetaSiteInfo(['general', 'namespaces']);
    }

    // ------------------------------------------------
    // -- WIKI 操作用方法：编辑类
    // ------------------------------------------------

    /**
     * 编辑一个页面
     * @param title 条目标题
     * @param text 条目内容
     * @param options 选项
     * @returns API 返回值
     */
    async editPage(title: string, text: string, options?: EditOptions) {
        return await this.apiEdit(title, text, options);
    }

    /**
     * 上传图片
     * @param filepath 需要上传的文件路径
     * @param filename 上传的文件名
     * @param options 选项
     * @param options.comment 上传注释
     * @param options.text 上传后的条目内容
     * @returns 操作结果
     */
    async uploadFile(filepath: string, filename: string, options?: { comment?: string; text?: string }) {
        let file: Buffer;
        try {
            file = readFileSync(filepath);
        } catch (e) {
            return {
                error: {
                    code: 'readfile-failed',
                    info: `读取文件失败：${filepath}`,
                },
            } as MWResponseUpload;
        }

        return await this.apiUpload(file, filename, options);
    }

    /** uploadFile别名 */
    async uploadImage(filepath: string, filename: string, options?: { comment?: string; text?: string }) {
        return await this.uploadFile(filepath, filename, options);
    }

    /**
     * 删除条目
     * @param title 要删除条目的标题
     * @param reason 删除理由
     * @returns 操作结果
     */
    async deletePage(title: string, reason?: string) {
        return await this.apiDelete(title, reason);
    }
    /**
     * 恢复删除的条目
     * @param title 要恢复删除的条目标题
     * @param reason 恢复理由
     * @returns 操作结果
     */
    async undeletePage(title: string, reason?: string) {
        return await this.apiUndelete(title, reason);
    }

    /**
     * 清理页面缓存
     * @param titles 要清理的条目标题
     * @returns 操作结果
     */
    async purgePage(titles: string[]) {
        return await this.apiPurge({ titles });
    }

    /**
     * 移动条目
     * @param from 原始条目标题
     * @param to 目标条目标题
     * @param options 选项
     * @returns 操作结果
     */
    async movePage(
        from: string,
        to: string,
        options?: {
            reason?: string;
            movetalk?: boolean;
            movesubpages?: boolean;
            noredirect?: boolean;
        }
    ) {
        return await this.apiMove(from, to, options);
    }

    // 回退编辑（后面再做）
}

const sleep = async (ms: number) => {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
};
