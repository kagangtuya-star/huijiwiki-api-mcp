import { HuijiWiki } from './HuijiWiki/HuijiWiki';

async function tryTest() {
    const prefix = process.env.HUIJI_PREFIX;
    const authKey = process.env.HUIJI_AUTHKEY;
    if (!prefix || !authKey) {
        throw new Error('HUIJI_PREFIX and HUIJI_AUTHKEY are required for the read-only dev check.');
    }
    const wiki = new HuijiWiki(prefix, authKey);
    wiki.setUserAgent(process.env.HUIJI_USER_AGENT ?? 'HuijiWiki-API-ReadOnly-Dev/1.0');
    console.log(await wiki.getSiteInfo());
}

tryTest();

export { HuijiWiki };
