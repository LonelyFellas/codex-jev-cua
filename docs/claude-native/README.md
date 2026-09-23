# Claude Code CLI：native MCP

此入口让 Claude Code 负责规划，经本地 stdio MCP 调用现有 Codex/Sky。**仅 native，不调用 Jev，不需要 TypeSafe Key，不要求安装 pi。** 仍要求 macOS、官方 Codex/Sky 运行时及用户授予的系统/应用权限；不是独立桌面引擎。

> **0.6.0 起推荐 [Claude Plugin 分发](../claude-plugin/README.md)**：由 `/plugin` 同时安装/升级 MCP 与 Skill，并通过 `cua_status` 查看版本。以下为旧版手动安装与源码调试流程，不是 Plugin 用户必做步骤。

## 手动安装：版本兼容

| 使用版本 | Claude 默认应用范围 | 权限 Skill |
|---|---|---|
| 已发布 `0.4.0` | 仅 Calculator（allowlist） | 不包含 |
| `0.5.0` 起（发布状态以 registry 为准） | **all，全应用**；已有显式限制保留 | 包含 `/deskhand-access` |

需要 macOS、Node.js ≥22.19、Claude Code，以及已经安装的 Codex/Sky 官方运行时。只装 npm 包不会自动安装 Sky 或授予系统权限。

## 手动安装：从源码安装 MCP 和 Skill

在包含本次改动的 checkout 构建：

```bash
npm ci --ignore-scripts
npm run check
npm run build
```

在 Claude Code 中注册（由用户执行，写入用户级 MCP 配置）：

```bash
claude mcp add --transport stdio --scope user deskhand -- node /absolute/path/to/checkout/dist/mcp/cli.js
```

再显式安装权限 Skill（**安装 MCP 不会自动装 Skill**）：

```bash
node /absolute/path/to/checkout/dist/mcp/install-access-skill.js --install
```

请将两处路径替换为实际构建路径。名称使用 `deskhand`，不要占用 Claude 的 `computer-use` 保留名称。新开 Claude 会话，通过 `/mcp` 检查连接，再请求调用 `cua_status`。全新无配置安装应显示 `host=mcp`、`mode=native`、`appAccess=all`、`appAccessSource=default`、`accessManagement.version=1`。

若已有名为 deskhand 的服务器，先用 `claude mcp get deskhand` 核对原安装来源与 scope，再由用户执行 `claude mcp remove deskhand --scope user`（仅当确实在 user scope）后重新注册；不要误删其他 scope 的配置。这不删除应用授权文件。不要同时用 pi/其他 Computer Use 通道控制同一桌面。

## npm 安装或升级至 0.5.0

先确认版本已发布，未查到时使用前面的源码方案，不假设 PR 合并就代表 npm 发布：

```bash
npm view jev-codex-cua@0.5.0 version
```

确认可用后分别安装 MCP 和权限 Skill：

```bash
claude mcp add --transport stdio --scope user deskhand -- npx -y --package=jev-codex-cua@0.5.0 deskhand-mcp
npx -y --package=jev-codex-cua@0.5.0 deskhand-install-claude-skill --install
```

若已有 deskhand，请先 `claude mcp get deskhand` 核对 scope，用户确认后移除旧注册再执行上面的 add；不是同时注册两个同名服务器。Skill 已有不同内容时安装器拒绝覆盖，先人工比较和备份处理。重启 Claude 或在 `/mcp` 重连，调用 `cua_status` 检查 `accessManagement.version=1` 及实际应用范围。**只升级 MCP 不会自动安装 Skill，只装 Skill 也不会升级 MCP。**

0.4.0 已支持 MCP，但没有权限 Skill，默认范围也不同；0.3.2 不包含 MCP 入口。

## 配置

**新源码默认 all，不需要为了访问微信逐个追加应用，也无需先创建配置文件。** 已发布的 0.4.0 默认仅允许 Calculator；旧版默认行为不会因阅读这份文档改变。已有显式 allowlist 选择仍优先，新版本不强行覆盖用户限制。

配置文件独立于 pi：`~/.config/deskhand/cua.env`，也可在启动环境设置 `DESKHAND_CONFIG_FILE` 为绝对路径。显式路径缺失或权限不安全时拒绝。不会读取项目 cwd 的 `.env`，不会自动扩大范围或修改文件。

如果希望主动收紧权限，用户可创建权限 600 的文件：

```dotenv
JEV_CUA_APP_ACCESS=allowlist
JEV_CUA_ALLOWED_APPS=Calculator,TextEdit,Google Chrome
```

需要全应用范围时由用户明确改为 `JEV_CUA_APP_ACCESS=all`。为了复用已有解析器，字段仍使用 `JEV_CUA_` 前缀，但 MCP 永远是 native；`JEV_CUA_MODE` 不会启用 Jev。不要放 TypeSafe 密钥。保留现有 `.apps.json` 与 `.access.json` 格式及优先级；用 status 核实生效来源。MCP 不提供扩权工具；下述用户主动调用的 Skill 通过受路径校验的本地 CLI 修改独立授权文件。

自定义路径注册示例：

```bash
claude mcp add --transport stdio --scope user deskhand --env DESKHAND_CONFIG_FILE=/absolute/path/to/cua.env -- node /absolute/path/to/checkout/dist/mcp/cli.js
```

## 通过 Skill 管理应用权限

MCP 安装不会自动安装 Claude Skill。此功能需使用包含 `accessManagement` 状态字段的 0.5.0 或更新版本/源码构建；已发布的 `0.4.0` 不包含它。先将 MCP 注册到此 checkout 的 `dist/mcp/cli.js`，在 Claude `/mcp` 重连，确认 `cua_status.accessManagement.version=1`。

显式安装用户级 Skill（不会修改应用权限、MCP 注册或 pi 配置）：

```bash
node /absolute/path/to/checkout/dist/mcp/install-access-skill.js --install
```

安装位置为 `~/.claude/skills/deskhand-access/SKILL.md`，设置了 `CLAUDE_CONFIG_DIR` 则使用该目录的 `skills/`。相同内容可重复安装，已有不同内容或符号链接会拒绝覆盖。首次创建 skills 目录后若 Claude 没发现命令，请重启 Claude Code。

随后在 Claude 中主动调用：

```text
/deskhand-access add WeChat
/deskhand-access add Google Chrome
/deskhand-access all
/deskhand-access allowlist
```

应用名称或 bundle ID 须与实际工具使用的一致；例如界面中的“微信”不一定就是传给 Sky 的名称。Skill 不自动启动应用查找。`add` 只追加一项、不清空名单、不切范围；`all/allowlist` 保存范围选择并保留名单。

Skill 先从**当前 MCP status** 获取实际配置/CLI 路径，专用脚本只操作 `.apps.json` / `.access.json`，不会读取密钥或编辑 env；修改后再次查询同一 MCP 验证生效。默认配置目录尚不存在时会创建私有目录，不创建 env。缺能力字段、路径冲突、活动任务、异常文件或锁冲突均停止，不猜路径、不自动扩权。

`all` 仍不替代 macOS/Sky 官方批准。普通“帮我发送消息”或权限错误不会自动调用这个 Skill。当前 pi 的 `/skill:jev-cua-access` 不用于 Claude MCP。

0.5.0 在 registry 确认发布后，可显式运行对应版本的 `deskhand-install-claude-skill --install` bin；不要用 0.4.0 执行不存在的安装器。安装 Skill 本身不会升级正在运行的 MCP，二者都需更新。

## 如何开启“最高权限”（插件全应用范围）

新版本全新安装已经默认 `all`。若 status 仍为 allowlist，可能是已有显式限制；在 Claude 中执行：

```text
/deskhand-access all
```

Skill 保存选择后会再读 `cua_status`，应显示 `appAccess=all`、`appAccessSource=grant-file`。这比手改 env 更明确：已保存的 `.access.json` 优先级高于环境变量和 env 文件。保留名单不删除，以后可 `/deskhand-access allowlist` 恢复。若 `/deskhand-access` 不存在，先按上面的步骤安装 Skill 并重启 Claude；如果提示缺少 `accessManagement` 字段，还要更新 MCP 并在 `/mcp` 重连，不能只安装 Skill。

仍使用 0.4.0 时，没有该 Skill：先让 Claude 调用 `cua_status` 获取 `envFile`/`appAccessSource`，由用户将实际 envFile 的 `JEV_CUA_APP_ACCESS` 设置为 `all`，保持文件权限 600；若来源已经是 grant-file，不应以修改 env 来声称覆盖成功，建议升级到支持此 Skill 的源码/后续版本。

**“all”不是 macOS 最高系统权限，也不是无限任务授权：**
1. 插件层：all 允许访问所有具体应用，但不自动打开或读取它们。
2. macOS 层：若官方运行时提示，在“系统设置 → 隐私与安全性 → 辅助功能 / 屏幕与系统音频录制”中按实际提示批准对应控制进程；名称随官方运行时安装而异，不盲目给所有程序勾选。
3. Sky 层：出现具体应用的官方批准弹窗时，由你确认允许；all 不关闭此弹窗。
4. 任务层：开始任务仍需确认，发送、删除、付款等仍需具体授权，不启用自动批准 hook 或跳过权限检查来代替它们。

## 使用

向 Claude 说：

> 使用 deskhand native 工具，在 Calculator 计算 6+7 并确认实际结果。不要使用其他桌面控制通道。

流程：
1. `cua_status`：只读配置状态，不启动 Sky。
2. `cua_task_begin({app, goal})`：通过 MCP form elicitation **向人确认**这一次任务；接受且勾选确认才返回 taskId。
3. `cua_get_app_state({taskId, app})`：首次读取。Sky 若需官方应用批准，会再次通过 elicitation 单独询问。
4. `cua_*({taskId, app, stateId, ...})`：操作。每个 stateId 单次使用；完整验证后的动作返回可提供新的 stateId，否则重新读取。
5. 核对实际状态后 `cua_task_end({taskId})`。结束不代表成功，也不会撤销动作。

0.7.0 起有 14 个工具：status、task_begin、task_end、launch_app，以及现有 10 个 native 观察/操作工具。用户明确要求打开应用时，先在已确认任务中用 `cua_launch_app` 按准确应用名称或 Bundle ID 启动/激活，再读取窗口；不要求用户手动打开。启动不保证窗口已就绪，也不替代 Sky/系统权限。截图作为 MCP image content 返回，不通过单独文件或外部服务传输。模型供应商仍可看到这些内容，遵守 Claude 会话隐私策略。

## 授权与预算

- MCP 没有 pi 的 agent turn 事件；使用显式 taskId，绑定一个具体应用。
- 0.7.1 起 native 任务不设总时长或动作次数上限，从任务确认完成开始累计耗时和动作数但不因达到 180 秒/30 次动作而停止。单次 Sky 调用/启动/确认请求的超时及用户取消仍有效。状态中的 durationMs/maxActions/remainingMs/remainingActions 为 null 表示无对应上限。
- 活动任务不能被 begin 覆盖。任务失败、拒绝、取消或结果未知时销毁任务和旧状态；不能自动重放。后续新任务必须再次经过人确认，不可靠模型自动续期。
- 开始任务的确认不是 Sky 官方批准，也不是删除/发送/支付的具体授权。后果性操作仍由 Claude 获取具体用户授权。
- 没有 form elicitation 能力的客户端无法开始任务；不提供 `approved=true`、无交互自动批准或 URL 授权旁路。不要配置自动批准 elicitation 的 hooks 来跳过这些用户确认。
- status/工具发现不需要 macOS 或 Sky，因此可在 CI 验证连接而不碰桌面。真正桌面请求仍受运行时与系统权限约束。

## 验证范围

实现包含 SDK 客户端协议测试（握手、工具发现、图片、输入校验、确认转交、预算、拒绝、取消）以及隔离安装下实际 stdio 子进程握手测试。不是模拟回复伪装实机操作。

本机检测到 Claude Code 2.1.280。官方文档说明支持 MCP stdio 与 form elicitation：[Claude Code MCP](https://code.claude.com/docs/en/mcp)。**尚未自动修改 Claude 配置、调用付费模型或完成 Claude→Sky 实机验收**；需用户执行注册命令并实际确认弹窗后验证。发布状态以 npm registry 为准；不保证所有旧版 Claude Code 都支持 elicitation。
