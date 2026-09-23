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
