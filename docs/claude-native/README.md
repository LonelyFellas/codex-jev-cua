# Claude Code CLI：native MCP

此入口让 Claude Code 负责规划，经本地 stdio MCP 调用现有 Codex/Sky。**仅 native，不调用 Jev，不需要 TypeSafe Key，不要求安装 pi。** 仍要求 macOS、官方 Codex/Sky 运行时及用户授予的系统/应用权限；不是独立桌面引擎。

## 本地安装（当前源码）

在此 checkout 构建：

```bash
npm ci --ignore-scripts
npm run check
npm run build
```

在 Claude Code 中注册（由用户执行，写入用户级 MCP 配置）：

```bash
claude mcp add --transport stdio --scope user deskhand -- node /absolute/path/to/checkout/dist/mcp/cli.js
```

请将路径替换为实际构建路径。名称使用 `deskhand`，不要占用 Claude 的 `computer-use` 保留名称。新开 Claude 会话，通过 `/mcp` 检查连接。不要同时用 pi/其他 Computer Use 通道控制同一桌面。

包从源码版本 `0.4.0` 提供 `deskhand-mcp` bin，`0.3.2` 不包含此入口。发布状态请先用 `npm view jev-codex-cua@0.4.0 version` 核实；仅在 registry 确认后，可使用以下安装命令：

```bash
claude mcp add --transport stdio --scope user deskhand -- npx -y --package=jev-codex-cua@0.4.0 deskhand-mcp
```

## 配置

默认只允许 Calculator。配置文件独立于 pi：`~/.config/deskhand/cua.env`，也可在启动环境设置 `DESKHAND_CONFIG_FILE` 为绝对路径。显式路径缺失或权限不安全时拒绝。不会读取项目 cwd 的 `.env`，不会自动扩大范围或修改文件。

用户可创建权限 600 的文件：

```dotenv
JEV_CUA_APP_ACCESS=allowlist
JEV_CUA_ALLOWED_APPS=Calculator,TextEdit,Google Chrome
```

需要全应用范围时由用户明确改为 `JEV_CUA_APP_ACCESS=all`。为了复用已有解析器，字段仍使用 `JEV_CUA_` 前缀，但 MCP 永远是 native；`JEV_CUA_MODE` 不会启用 Jev。不要放 TypeSafe 密钥。保留现有 `.apps.json` 与 `.access.json` 格式及优先级；用 status 核实生效来源。MCP 不提供扩权工具。

自定义路径注册示例：

```bash
claude mcp add --transport stdio --scope user deskhand --env DESKHAND_CONFIG_FILE=/absolute/path/to/cua.env -- node /absolute/path/to/checkout/dist/mcp/cli.js
```

## 使用

向 Claude 说：

> 使用 deskhand native 工具，在 Calculator 计算 6+7 并确认实际结果。不要使用其他桌面控制通道。

流程：
1. `cua_status`：只读配置状态，不启动 Sky。
2. `cua_task_begin({app, goal})`：通过 MCP form elicitation **向人确认**这一次任务；接受且勾选确认才返回 taskId。
3. `cua_get_app_state({taskId, app})`：首次读取。Sky 若需官方应用批准，会再次通过 elicitation 单独询问。
4. `cua_*({taskId, app, stateId, ...})`：操作。每个 stateId 单次使用；完整验证后的动作返回可提供新的 stateId，否则重新读取。
5. 核对实际状态后 `cua_task_end({taskId})`。结束不代表成功，也不会撤销动作。

13 个工具：status、task_begin、task_end，以及现有 10 个 native 观察/操作工具。截图作为 MCP image content 返回，不通过单独文件或外部服务传输。模型供应商仍可看到这些内容，遵守 Claude 会话隐私策略。

## 授权与预算

- MCP 没有 pi 的 agent turn 事件；使用显式 taskId，绑定一个具体应用。
- 每个任务 180 秒/30 次动作尝试，从任务确认完成开始；Sky 官方授权等待、模型规划和工具间隔均计入。调用前检查时间，调用中超时取消并关闭连接。
- 活动任务不能被 begin 覆盖。任务失败、拒绝、取消或结果未知时销毁任务和旧状态；不能自动重放。后续新任务必须再次经过人确认，不可靠模型自动续期。
- 开始任务的确认不是 Sky 官方批准，也不是删除/发送/支付的具体授权。后果性操作仍由 Claude 获取具体用户授权。
- 没有 form elicitation 能力的客户端无法开始任务；不提供 `approved=true`、无交互自动批准或 URL 授权旁路。不要配置自动批准 elicitation 的 hooks 来跳过这些用户确认。
- status/工具发现不需要 macOS 或 Sky，因此可在 CI 验证连接而不碰桌面。真正桌面请求仍受运行时与系统权限约束。

## 验证范围

实现包含 SDK 客户端协议测试（握手、工具发现、图片、输入校验、确认转交、预算、拒绝、取消）以及隔离安装下实际 stdio 子进程握手测试。不是模拟回复伪装实机操作。

本机检测到 Claude Code 2.1.280。官方文档说明支持 MCP stdio 与 form elicitation：[Claude Code MCP](https://code.claude.com/docs/en/mcp)。**尚未自动修改 Claude 配置、调用付费模型或完成 Claude→Sky 实机验收**；需用户执行注册命令并实际确认弹窗后验证。发布状态以 npm registry 为准；不保证所有旧版 Claude Code 都支持 elicitation。
