# Claude Plugin：统一安装与升级

0.6.0 起提供 `deskhand@deskhand` Plugin：MCP 与 Claude 权限 Skill 由 `/plugin` 一起管理。需要 macOS、Node.js ≥22.19、支持 Plugin/MCP elicitation 的 Claude Code 和已安装的 Codex/Sky。发布前仅可做本地结构验证；仓库合并不表示 npm 已发布。

## 安装（发布后）

在 Claude Code 执行：

```text
/plugin marketplace add LonelyFellas/jev-codex-cua
/plugin install deskhand@deskhand
```

重启 Claude Code，通过 `/mcp` 检查连接，并调用 `cua_status`。应返回 `host=mcp`、`mode=native`、`version.distribution=claude-plugin`、`version.currentVersion`。权限 Skill 为 `/deskhand:deskhand-access add WeChat`（也支持 `all` / `allowlist`）。不用另装 Skill、不用记 npm 版本。

Plugin 的 MCP 启动配置固定绑定同版本 npm 包，由 npx 获取依赖；不会使用 `@latest` 独立升级 MCP。首次启动需要网络。Plugin 不捆绑 Sky，不自动授予系统权限；全新安装保持现有 `all` 默认，有显式限制则保留。发送、删除、付款等仍需具体授权。

## 版本提示与更新

- `cua_status {}`：仅本地状态，`version.latestVersion=null`、`updateCheck=not-checked`，不请求网络。
- 用户要求检查更新时：`cua_status {"checkUpdates":true}`。只读取公开 npm latest 元数据，超时 5 秒；返回当前版本、最新已发布 MCP 版本、是否有新版和升级方式。失败返回 `unavailable`，不猜最新版本、不影响本地诊断。
- 更新：打开 `/plugin`，刷新 `deskhand` marketplace 并更新已安装的 `deskhand@deskhand`；重启 Claude Code。MCP 与 Skill 同步更新。插件不自行运行更新命令，不写 Claude 配置、授权文件或系统权限；Claude 自身的自动更新策略由用户管理。

## 0.6.1：单次 Accept 确认

0.6.0 的确认表单同时要求勾选 `confirm` 并点击 Accept，造成部分 Claude 界面无法完成批准。0.6.1 去掉复选框，弹窗显示具体任务/官方申请，**直接选择 Accept 即批准该次请求**；Decline 或 Cancel 仍停止，不自动重试。任务确认与 Sky 官方确认仍是独立请求，不会因为上一次 Accept 或 `appAccess=all` 而自动批准后续申请。

`cua_status.confirmation` 返回 `interaction=accept-only`、客户端 `formSupported` 和最近一次确认的 `lastResult`。结果区分 `accepted`、`declined`、`cancelled`、`unsupported`、`request_cancelled`、`timed_out`、`request_failed`，并标明发生在 `task` 还是 `sky` 阶段。协议错误只报告数字错误码，不回显原始表单、消息内容或可能含凭据的异常。

发布后在 `/plugin` 刷新 marketplace 并更新 Deskhand，重启 Claude Code，确认 `version.currentVersion=0.6.1`、`confirmation.interaction=accept-only`。不需要重设 all、删除授权文件或提升 root 权限。

验收时用 Calculator 只读任务：确认弹窗没有复选框，点击一次 Accept 后任务能开始；Sky 若单独申请则另行正常确认；Decline/Cancel 应停止。自动化覆盖真实 MCP 协议握手和模拟客户端返回，不代替用户在 Claude 界面的手动确认验收。

## 0.7.0：主动打开任意已安装应用

用户可直接说“打开微信并读取窗口”“打开飞书”或“打开 Safari”。新增 `cua_launch_app`，不是仅支持预设的几款应用；`all` 下可针对任何已安装、已注册应用，显式 allowlist 下仍须与名单及当前任务一致。

Agent 先以准确应用名或 Bundle ID 建立任务，在一次任务确认后调用启动工具，再用 Sky 读取状态验证。例如任务 app 为 `WeChat` 时传 `identityType=name`；任务 app 为 `com.tencent.xinWeChat` 时传 `identityType=bundleId`。用户无需手写参数，但本地化别名与注册名称不一致时需要先识别实际应用，不应把名称识别失败说成系统权限不足。

启动由 macOS LaunchServices 完成，会打开/激活应用，计入一次动作；不需要已有窗口或 stateId。返回只说明系统接受启动请求，不保证窗口就绪；旧 stateId 失效，必须重新观察。只读请求不自动启动，Sky 拒绝或未知结果不自动换路径重试。工具不接受 URL、文件、脚本或额外启动参数，不安装应用、不修改系统权限。

发布后通过 `/plugin` 更新并重启。先用“打开 Calculator 并只读取窗口，不点击、不输入”验收，确认既能启动也能观察；本版本仍需真实桌面验收，自动化仅模拟启动，不会打开用户应用。

## 通用 state_changed 恢复

0.7.0 的 native 调用遇到 `state_changed` 时，不再直接结束整个任务：旧状态失效，原 taskId 与剩余时间/动作预算保留，状态显示 `recovery`。此时仅允许同应用的 `cua_get_app_state`；不自动启动、点击、输入或重新发送失败操作。成功读取后，Agent 先核对当前可见结果，再选择必要的新动作；结果无法确认时询问用户。此机制适用于所有应用，不包含飞书、微信或聊天场景专用逻辑。

取消、官方拒绝、超时或其他底层错误仍停止；重新观察不会恢复已耗尽预算。新状态只证明观察成功，不证明上次写操作成功或失败。

pi native 同步提供相同恢复及 `cua_launch_app`，但 pi 安装与 Claude Plugin 独立。发布后需单独 `pi update npm:jev-codex-cua` 并 `/reload`；固定旧版本的安装应显式安装新版本。pi 不使用 MCP taskId，而是沿用本轮预算。

## 0.7.1：仅 native 取消任务总量限制

pi native 与 Claude MCP 不再受 180 秒总时长和 30 次动作次数限制。耗时和次数继续记录；budget 中 durationMs/maxActions/remainingMs/remainingActions 为 null 表示无上限，而不是预算耗尽。Jev 仍保留原预算，模式切换不会重置本轮已累计时间/次数。

单次调用及确认等待超时、用户取消、同应用任务范围、stateId 时效、系统/Sky 授权、未知结果禁止重放均不改变。更新后不需要重新授予 all，也不应为绕过拒绝或单次请求失败切模式/重启任务。通过 /plugin 更新并重启 Claude；pi 独立更新包并 /reload。

## 从手动安装迁移

先核对 `/mcp` 和旧服务器的来源、scope、自定义环境变量。经用户确认后禁用/移除旧 Deskhand MCP，再安装 Plugin，避免两个实例。自定义 `DESKHAND_CONFIG_FILE` 等设置需要用户按 Claude 支持的配置方式保留，不能静默丢弃或复制。默认授权文件仍位于原来的 `~/.config/deskhand/`，无需搬迁。

旧 `~/.claude/skills/deskhand-access` 不会被 Plugin 覆盖；确认是本项目旧安装且无自定义修改后，由用户卸载旧 Skill，改用 Plugin 命名空间。**迁移不是授权扩大应用范围**。不删除用户授权文件、不修改 pi 安装。

## 维护与验收

- 源码：`.claude-plugin/marketplace.json` 指向 `plugins/deskhand`，后者独立于 pi 的 `skills/`。
- 每次发布同步 `package.json`、lockfile、Plugin manifest 版本和 `.mcp.json` 中的固定 npm 版本。
- 权限 Skill 兼容旧独立安装：修改 `claude-skills/deskhand-access/SKILL.md` 后同步 Plugin 副本；测试强制逐字一致。
- `npm run check && npm test && npm run test:package` 检查版本绑定、Skill 一致性、状态协议与 npm 安装产物。
- 本地可运行 `claude plugin validate .` 及 `claude plugin validate ./plugins/deskhand` 验证结构。`claude --plugin-dir ./plugins/deskhand` 仍会启动固定发布版本，不是未发布源码；未发布时不要声称实机安装成功。
- 发布者须确认对应 npm 版本发布成功，才对外宣布 Plugin 可安装/更新；若发布失败，修复发布而非要求用户手动改 Plugin 缓存版本。

当前自动化不代表 Claude 实机 Plugin 安装、Sky 权限和桌面操作已验收。
