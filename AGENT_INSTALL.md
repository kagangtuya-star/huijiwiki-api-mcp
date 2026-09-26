# WorkBuddy / 其他 Agent 安装指南

本文用于让 WorkBuddy 或其他支持 stdio MCP 的 Agent 安装并调用本项目。项目根目录中的 `init.cmd` 负责安装依赖和构建，`workbuddy.cmd` 负责启动 MCP Server，并会在首次调用时自动执行初始化。

## 1. 前置条件

- Windows 10/11；其他系统也可以直接使用 Yarn 命令。
- Node.js 18 或更高版本，并且 `node`、`npm` 在 `PATH` 中。脚本会直接复用 Agent 当前的 Node，不会另行安装全局 Node。
- 能访问 npm 镜像和 `cdn.sheetjs.com`（`xlsx` 依赖来自该 CDN）。
- 项目目录不能是只读目录。

## 2. 获取项目

将仓库克隆到固定目录，后续配置中的路径必须使用绝对路径：

```bat
git clone https://github.com/kagangtuya-star/huijiwiki-api-mcp.git C:\Tools\huijiwiki-api-mcp
cd /d C:\Tools\huijiwiki-api-mcp
```

如果项目已经由 Agent checkout，直接进入该目录即可。

## 3. 配置环境变量

复制模板并填写真实值：

```bat
copy .env.example .env
```

需要配置的字段：

- `HUIJI_PREFIX`：必填，例如 `pf2`。
- `HUIJI_AUTHKEY`：必填，灰机 Wiki API 的 `X-authkey`。
- `HUIJI_BOT_USERNAME` / `HUIJI_BOT_PASSWORD`：写入页面或调用已登录身份时需要，必须同时提供或同时留空。
- `HUIJI_USER_AGENT`：可选。

`.env.example` 只是模板；当前 MCP 进程不会自动读取 `.env`。请把这些变量配置到 WorkBuddy/Agent 的 MCP 环境中，或在启动命令前由操作系统注入。

如果 Agent 使用独立 Node 环境，将该环境中包含 `node.exe` 的目录配置为 `WORKBUDDY_NODE_HOME`。脚本会优先使用它，并让同一目录中的 `npm`、`npx` 和 `corepack` 参与安装；未设置时直接继承 Agent 当前的 `PATH`。

## 4. 一次性安装和构建

在项目根目录执行：

```bat
cmd.exe /d /s /c call "C:\Tools\huijiwiki-api-mcp\init.cmd"
```

脚本会：

1. 自动切换到脚本所在目录；
2. 设置清华 npm 镜像；
3. 优先使用 Corepack 的 Yarn 4.12.0，没有可用 Corepack 时回退到 `npx`；
4. 执行 `yarn install --immutable`；
5. 执行 `yarn build`。

依赖或锁文件发生变化时，`--immutable` 会阻止隐式改写 `yarn.lock`。只有维护者确认依赖变更时，才应在项目根目录运行普通的 `yarn install` 并检查锁文件差异。

## 5. WorkBuddy 调用命令

将下面命令作为 WorkBuddy 的 MCP stdio 入口：

```text
cmd.exe /d /s /c call "C:\Tools\huijiwiki-api-mcp\workbuddy.cmd"
```

首次调用时，如果依赖或 `dist/mcp/server.js` 不存在，脚本会自动安装并构建。安装输出会走 stderr，stdout 保留给 MCP 协议。

常见的结构化配置条目如下（具体外层键名按 Agent 的配置格式放置）：

```json
{
  "command": "cmd.exe",
  "args": [
    "/d",
    "/s",
    "/c",
    "call \"C:\\Tools\\huijiwiki-api-mcp\\workbuddy.cmd\""
  ],
  "env": {
    "WORKBUDDY_NODE_HOME": "C:\\Path\\To\\agent-node",
    "HUIJI_PREFIX": "pf2",
    "HUIJI_AUTHKEY": "<authkey>",
    "HUIJI_BOT_USERNAME": "<bot username>",
    "HUIJI_BOT_PASSWORD": "<bot password>",
    "HUIJI_USER_AGENT": "PF2-Wiki-MCP/1.0 (huijiwiki-api)"
  }
}
```

如果 Agent 允许先执行安装命令再启动服务，也可以将一次性初始化命令配置为：

```text
cmd.exe /d /s /c call "C:\Tools\huijiwiki-api-mcp\init.cmd"
```

## 6. 其他 Agent 的 stdio 调用

完成构建后，任何支持 stdio MCP 的 Agent 都可以直接启动：

```text
node C:\Tools\huijiwiki-api-mcp\dist\mcp\server.js
```

Windows 下如果 Agent 只能启动 `.cmd`，使用 `workbuddy.cmd`。不要把普通日志写入 MCP stdout；本项目的启动脚本已经将安装日志放到 stderr。

## 7. 验证

在项目根目录执行：

```bat
npm test
```

如果 Agent 启动后立即退出，优先检查：

- `HUIJI_PREFIX` 和 `HUIJI_AUTHKEY` 是否已注入；
- 成对的机器人账号变量是否只配置了一项；
- `node --version` 是否为 18 或更高版本；
- WorkBuddy 配置中的路径是否为绝对路径；
- 是否有权限写入 `node_modules` 和 `dist`。

需要强制重新安装时，在启动 WorkBuddy 前设置：

```bat
set WORKBUDDY_FORCE_INSTALL=1
```

不要把 `.env`、真实 AuthKey 或机器人密码提交到 Git。写操作仍应遵循 README 中的版本校验和并发保护要求。
