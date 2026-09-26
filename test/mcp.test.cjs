const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const { HuijiRequester } = require('../dist/HuijiWiki/HuijiRequester.js');
const { HuijiWiki } = require('../dist/HuijiWiki/HuijiWiki.js');
const publicApi = require('../dist/index.js');
const {
    HuijiMcpClient,
    loadMcpConfig,
} = require('../dist/mcp/client.js');

const validEnv = {
    HUIJI_PREFIX: 'pf2',
    HUIJI_AUTHKEY: 'test-auth-key',
    HUIJI_BOT_USERNAME: 'TestBot',
    HUIJI_BOT_PASSWORD: 'test-bot-password',
};

test('existing HuijiWiki library exports remain available', () => {
    assert.equal(publicApi.HuijiWiki, HuijiWiki);
    assert.equal(typeof publicApi.HuijiTabx, 'function');
});

function mockWiki(overrides = {}) {
    return {
        setUserAgent() {},
        getLastErrorMessage() {
            return '';
        },
        async apiLogin() {
            return true;
        },
        async request() {
            return {};
        },
        async editPage() {
            return {
                edit: {
                    result: 'Success',
                    title: 'Example',
                    pageid: 1,
                    oldrevid: 10,
                    newrevid: 11,
                },
            };
        },
        ...overrides,
    };
}

test('environment configuration validates required and paired credentials', () => {
    assert.throws(() => loadMcpConfig({}), /HUIJI_PREFIX is required/);
    assert.throws(
        () =>
            loadMcpConfig({
                HUIJI_PREFIX: 'pf2',
                HUIJI_AUTHKEY: 'key',
                HUIJI_BOT_USERNAME: 'bot',
            }),
        /must be provided together/
    );
    assert.equal(loadMcpConfig(validEnv).userAgent, 'PF2-Wiki-MCP/1.0 (huijiwiki-api)');
});

test('get_page normalizes latest revision metadata and source', async () => {
    const wiki = mockWiki({
        async request() {
            return {
                query: {
                    pages: [
                        {
                            pageid: 42,
                            ns: 0,
                            title: 'Test page',
                            revisions: [
                                {
                                    revid: 200,
                                    parentid: 199,
                                    timestamp: '2026-09-26T00:00:00Z',
                                    slots: {
                                        main: {
                                            contentmodel: 'wikitext',
                                            content: 'latest source',
                                        },
                                    },
                                },
                            ],
                        },
                    ],
                },
            };
        },
    });
    const client = new HuijiMcpClient(validEnv, () => wiki);
    assert.deepEqual(await client.getPage('Test page'), {
        title: 'Test page',
        pageid: 42,
        namespace: 0,
        missing: false,
        revid: 200,
        parentid: 199,
        timestamp: '2026-09-26T00:00:00Z',
        contentmodel: 'wikitext',
        content: 'latest source',
    });
});

test('HuijiWiki edit maps safe update and create flags to MediaWiki parameters', async () => {
    const wiki = new HuijiWiki('pf2', 'not-a-real-key');
    const requests = [];
    wiki.apiQueryCsrfToken = async () => 'csrf';
    wiki.requester.request = async (params) => {
        requests.push(params);
        return {
            edit: {
                result: 'Success',
                title: params.title,
                pageid: 1,
                oldrevid: 1,
                newrevid: 2,
            },
        };
    };

    await wiki.editPage('Existing', 'new text', {
        baseRevId: 123,
        noCreate: true,
        summary: 'safe update',
    });
    await wiki.editPage('New', 'text', { createOnly: true, summary: 'safe create' });

    assert.equal(requests[0].baserevid, 123);
    assert.equal(requests[0].nocreate, '1');
    assert.equal(requests[0].bot, '1');
    assert.equal(requests[1].createonly, '1');
    assert.equal(requests[1].bot, '1');
});

test('update_page passes baserevid and nocreate through the library options', async () => {
    let captured;
    const wiki = mockWiki({
        async editPage(_title, _text, options) {
            captured = options;
            return {
                edit: {
                    result: 'Success',
                    title: 'Existing',
                    pageid: 1,
                    oldrevid: 123,
                    newrevid: 124,
                },
            };
        },
    });
    const client = new HuijiMcpClient(validEnv, () => wiki);
    await client.updatePage({
        title: 'Existing',
        text: 'new text',
        expectedRevId: 123,
        summary: 'update safely',
    });
    assert.equal(captured.baseRevId, 123);
    assert.equal(captured.noCreate, true);
    assert.equal(captured.isBot, true);
});

test('create_page always uses createonly', async () => {
    let captured;
    const wiki = mockWiki({
        async editPage(_title, _text, options) {
            captured = options;
            return {
                edit: { result: 'Success', title: 'New', pageid: 2, newrevid: 1 },
            };
        },
    });
    const client = new HuijiMcpClient(validEnv, () => wiki);
    await client.createPage({ title: 'New', text: 'text', summary: 'create safely' });
    assert.equal(captured.createOnly, true);
    assert.equal(captured.isBot, true);
});

test('write methods reject an empty summary and invalid expectedRevId', async () => {
    const client = new HuijiMcpClient(validEnv, () => mockWiki());
    await assert.rejects(
        client.createPage({ title: 'New', text: 'text', summary: '   ' }),
        /summary must be a non-empty string/
    );
    await assert.rejects(
        client.updatePage({ title: 'Page', text: 'text', expectedRevId: 0, summary: 'update' }),
        /expectedRevId must be a positive integer/
    );
    await assert.rejects(
        client.updatePage({ title: 'Page', text: 'text', summary: 'update' }),
        /expectedRevId must be a positive integer/
    );
});

test('safe errors redact authkey and bot password', async () => {
    const wiki = mockWiki({
        async apiLogin() {
            throw new Error(`credentials: ${validEnv.HUIJI_AUTHKEY} ${validEnv.HUIJI_BOT_PASSWORD}`);
        },
    });
    const client = new HuijiMcpClient(validEnv, () => wiki);
    let error;
    try {
        await client.createPage({ title: 'New', text: 'text', summary: 'create' });
    } catch (caught) {
        error = caught;
    }
    const safe = client.safeError(error);
    assert.doesNotMatch(safe.message, /test-auth-key|test-bot-password/);
    assert.match(safe.message, /\[REDACTED\]/);
});

test('MediaWiki editconflict is propagated without retrying or overwriting', async () => {
    let edits = 0;
    const wiki = mockWiki({
        async editPage() {
            edits += 1;
            return { error: { code: 'editconflict', info: 'Edit conflict', '*': '' } };
        },
    });
    const client = new HuijiMcpClient(validEnv, () => wiki);
    await assert.rejects(
        client.updatePage({
            title: 'Existing',
            text: 'new text',
            expectedRevId: 123,
            summary: 'safe update',
        }),
        (error) => error.code === 'editconflict'
    );
    assert.equal(edits, 1);
});

test('HTTP 403 Cloudflare HTML becomes a concise safe error', async () => {
    let calls = 0;
    const hugeHtml = `<!doctype html><title>Just a moment...</title><div>cloudflare</div>${'x'.repeat(
        5000
    )}`;
    const requester = new HuijiRequester('pf2', 'secret-authkey', {
        httpClient: {
            async request() {
                calls += 1;
                return {
                    status: 403,
                    statusText: 'Forbidden',
                    headers: { 'content-type': 'text/html; charset=UTF-8' },
                    config: {},
                    data: hugeHtml,
                };
            },
        },
    });
    await assert.rejects(requester.get({ action: 'query' }), (error) => {
        assert.equal(error.code, 'cloudflare-challenge');
        assert.match(error.message, /HTTP 403.*Cloudflare challenge/);
        assert.ok(error.message.length < 200);
        assert.doesNotMatch(error.message, /secret-authkey|xxxxx/);
        return true;
    });
    assert.equal(calls, 1);
});

test('stdio MCP startup does not write ordinary output to stdout', async () => {
    const serverPath = path.resolve(__dirname, '../dist/mcp/server.js');
    const child = spawn(process.execPath, [serverPath], {
        cwd: path.resolve(__dirname, '..'),
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {},
    });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
        stdout += chunk;
    });

    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(stdout, '');
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('close', resolve));
});
