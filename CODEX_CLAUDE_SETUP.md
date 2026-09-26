# Codex / Claude 独立 MCP 环境指南

本文用于为 Codex 或 Claude 建立一个与其他项目隔离的 HuijiWiki MCP 环境。建议每个客户端、账号或 Wiki 前缀使用独立 checkout、独立配置和独立凭据，避免环境变量串用。

## 1. 推荐目录布局

```text
C:\Tools\huijiwiki-api-mcp-codex\
C:\Tools\huijiwiki-api-mcp-claude\
```

可以从同一仓库复制两份，也可以使用两个独立的 Git worktree。每份目录都单独执行初始化和构建：

```bat
cmd.exe /d /s /c call "C:\Tools\huijiwiki-api-mcp-codex\init.cmd"
cmd.exe /d /s /c call "C:\Tools\huijiwiki-api-mcp-claude\init.cmd"
```

## 2. 凭据隔离

复制 [`.env.example`](.env.example) 作为填写模板。不要让 Codex 和 Claude 共用可写入账号的凭据：

- Codex 使用一组 `HUIJI_*` 值；
- Claude 使用另一组 `HUIJI_*` 值；
- 只读场景将 `HUIJI_BOT_USERNAME` 和 `HUIJI_BOT_PASSWORD` 同时留空；
- 真实凭据只放在客户端的环境配置中，不提交到仓库。

`.env.example` 不会被 MCP Server 自动加载。Codex/Claude 配置中的 `env` 字段才是最稳定的注入方式。

如果 Codex 或 Claude 已经由 Agent 运行时提供独立 Node 环境，可在同一 MCP 条目的 `env` 中设置 `WORKBUDDY_NODE_HOME`，值为包含 `node.exe` 的目录。未设置时，启动脚本直接继承客户端当前的 `PATH`；不会再安装或覆盖全局 Node。

## 3. Codex 配置

在 Codex 的 MCP 配置中新增一个独立服务条目。Windows 推荐通过 `workbuddy.cmd` 启动，这样首次启动也能自动完成安装：

```toml
[mcp_servers.huijiwiki_codex]
command = "cmd.exe"
args = ["/d", "/s", "/c", "call \"C:\\Tools\\huijiwiki-api-mcp-codex\\workbuddy.cmd\""]
startup_timeout_sec = 60
tool_timeout_sec = 120
default_tools_approval_mode = "writes"

[mcp_servers.huijiwiki_codex.env]
WORKBUDDY_NODE_HOME = "C:\\Path\\To\\codex-node"
HUIJI_PREFIX = "pf2"
HUIJI_AUTHKEY = "<codex-authkey>"
HUIJI_BOT_USERNAME = "<codex-bot-username>"
HUIJI_BOT_PASSWORD = "<codex-bot-password>"
HUIJI_USER_AGENT = "PF2-Wiki-MCP/1.0 (codex)"
```

如果已经手动运行过 `init.cmd`，也可以直接调用构建结果：

```toml
[mcp_servers.huijiwiki_codex]
command = "node"
args = ["C:/Tools/huijiwiki-api-mcp-codex/dist/mcp/server.js"]

[mcp_servers.huijiwiki_codex.env]
HUIJI_PREFIX = "pf2"
HUIJI_AUTHKEY = "<codex-authkey>"
```

## 4. Claude Desktop / Claude 类 MCP 客户端配置

在客户端支持的 MCP JSON 配置中加入独立服务。下面是 Windows stdio 配置示例：

```json
{
  "mcpServers": {
    "huijiwiki-claude": {
      "command": "cmd.exe",
      "args": [
        "/d",
        "/s",
        "/c",
        "call \"C:\\Tools\\huijiwiki-api-mcp-claude\\workbuddy.cmd\""
      ],
      "env": {
        "WORKBUDDY_NODE_HOME": "C:\\Path\\To\\claude-node",
        "HUIJI_PREFIX": "pf2",
        "HUIJI_AUTHKEY": "<claude-authkey>",
        "HUIJI_BOT_USERNAME": "<claude-bot-username>",
        "HUIJI_BOT_PASSWORD": "<claude-bot-password>",
        "HUIJI_USER_AGENT": "PF2-Wiki-MCP/1.0 (claude)"
      }
    }
  }
}
```

Claude Code 或其他 MCP 客户端的外层配置键可能不同，但核心字段保持一致：`command`、`args`、`env`，传输方式为 stdio。

## 5. 独立环境检查清单

- 配置名称不同，例如 `huijiwiki_codex` 与 `huijiwiki-claude`；
- checkout 路径不同，避免两个客户端同时操作同一个 `dist` 或 `node_modules`；
- `HUIJI_AUTHKEY`、机器人账号和 `HUIJI_USER_AGENT` 分开配置；
- 每份 checkout 都执行过 `init.cmd`，并确认 `dist/mcp/server.js` 存在；
- MCP 服务的 stdout 只由协议使用，诊断信息查看 stderr；
- 写操作前先读取页面并使用 `expectedRevId`，不要把两个客户端的写入凭据混用。

## 6. 非 Windows 环境

在 Linux/macOS 中，每份独立 checkout 分别执行：

```bash
corepack yarn install --immutable
corepack yarn build
node ./dist/mcp/server.js
```

将同一组 `HUIJI_*` 变量放到对应客户端的 MCP `env` 配置中即可。
