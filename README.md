# HuijiWiki API
因为懒得学习别人写的所以自己瞎造的轮子

## MCP Server

本包在保留原有 `HuijiWiki` Node/TypeScript API 的同时，提供本地 stdio MCP Server。构建产物入口为 `dist/mcp/server.js`，stdout 仅用于 MCP 协议。

运行前按需设置以下环境变量：

- `HUIJI_PREFIX`：必需，例如 `pf2`。
- `HUIJI_AUTHKEY`：必需，用于灰机 Wiki API 的 `X-authkey`。
- `HUIJI_BOT_USERNAME`：写操作以及已配置身份的 `huiji_whoami` 所用机器人用户名。
- `HUIJI_BOT_PASSWORD`：与 `HUIJI_BOT_USERNAME` 配套；它和 AuthKey 是两个不同凭据。
- `HUIJI_USER_AGENT`：可选，默认为 `PF2-Wiki-MCP/1.0 (huijiwiki-api)`。

安装、构建并运行：

```bash
yarn install
yarn build
yarn mcp
```

Windows 初始化脚本：

```bat
init.cmd
```

脚本会自动切换到项目目录，使用清华 npm 镜像，通过 Corepack（没有 Corepack 时回退到 `npx`）安装锁定版本的 Yarn 4.12.0，执行 `yarn install --immutable` 和 `yarn build`。需要重复安装时可设置 `WORKBUDDY_FORCE_INSTALL=1`。

详细的 Agent 安装步骤见 [`AGENT_INSTALL.md`](AGENT_INSTALL.md)，环境变量模板见 [`.env.example`](.env.example)。Codex/Claude 独立环境配置见 [`CODEX_CLAUDE_SETUP.md`](CODEX_CLAUDE_SETUP.md)。

WorkBuddy 可直接把下面的命令配置为 MCP 服务入口。首次调用时会自动安装依赖并构建；安装日志写入 stderr，不会污染 MCP 的 stdout 协议流：

```text
cmd.exe /d /s /c call "C:\ABSOLUTE\PATH\huijiwiki-api-mcp\workbuddy.cmd"
```

如果 Agent 已有独立 Node 环境，在 MCP 的 `env` 中设置 `WORKBUDDY_NODE_HOME` 为包含 `node.exe` 的目录；未设置时脚本直接使用 Agent 当前 `PATH` 中的 Node，不会另行安装全局 Node。

也可以先手动执行一次下面的初始安装命令，再让 WorkBuddy 调用 `workbuddy.cmd`：

```text
cmd.exe /d /s /c call "C:\ABSOLUTE\PATH\huijiwiki-api-mcp\init.cmd"
```

如果 WorkBuddy 提供结构化 MCP 配置，等价配置为：

```json
{
  "command": "cmd.exe",
  "args": [
    "/d",
    "/s",
    "/c",
    "call \"C:\\ABSOLUTE\\PATH\\huijiwiki-api-mcp\\workbuddy.cmd\""
  ],
  "env": {
    "HUIJI_PREFIX": "pf2",
    "HUIJI_AUTHKEY": "<authkey>",
    "HUIJI_BOT_USERNAME": "<bot username>",
    "HUIJI_BOT_PASSWORD": "<bot password>",
    "HUIJI_USER_AGENT": "PF2-Wiki-MCP/1.0 (huijiwiki-api)"
  }
}
```

Codex 的 `config.toml` 示例（请替换为真实绝对路径）：

```toml
[mcp_servers.huijiwiki]
command = "node"
args = ["/ABSOLUTE/PATH/huijiwiki-api/dist/mcp/server.js"]
startup_timeout_sec = 30
tool_timeout_sec = 120
default_tools_approval_mode = "writes"

[mcp_servers.huijiwiki.env]
HUIJI_PREFIX = "pf2"
HUIJI_AUTHKEY = "<authkey>"
HUIJI_BOT_USERNAME = "<bot username>"
HUIJI_BOT_PASSWORD = "<bot password>"
HUIJI_USER_AGENT = "PF2-Wiki-MCP/1.0 (huijiwiki-api)"
```

生产写入约束：`huiji_update_page` 必须提供线上读取所得的 `expectedRevId`，并使用 `baserevid` 与 `nocreate` 防止覆盖并发修改或隐式创建；`huiji_create_page` 始终使用 `createonly`。服务不提供 delete、move 或 upload 工具。推荐每次写入前先调用 `huiji_get_page`，再用 `huiji_compare` 审阅候选 Wikitext。

# 更新日志
## 0.8.4 - 2026-01-11
- 不知道为什么现在query loginToken时不会获得huiji_session，导致登录失败。做了新的检测，当未正常获取到时，自动通过clientlogin获取huiji_session。

## 0.8.3
- 修复了tabx功能占用大量性能的问题
