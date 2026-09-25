# jev-codex-cua

[English](README.md) | 简体中文

基于已安装的 Codex/Sky 运行时，为 [pi](https://pi.dev) 提供桌面操作工具。

- **Native（默认）**：pi 主 Agent 读取应用状态和截图，直接使用原生工具，无需 TypeSafe Key。
- **Jev（可选）**：通过 TypeSafe 执行纯文本决策循环，目标不确定时交回主 Agent。

> **实验项目，仅支持 macOS。** 需要 Codex/Sky 运行时及其权限，包内不包含这些二进制。已验证部分 Calculator 任务；复杂表单、浏览器控件和多步流程仍不可靠。测试通过不代表桌面任务一定成功。

## Claude Code CLI（native）

新增本地 stdio MCP 入口 `deskhand-mcp`，复用 Codex/Sky，不依赖 pi，不调用 Jev。使用显式任务预算和用户 elicitation 确认。源码版本 0.4.0 起支持，见[Claude Code 接入说明](docs/claude-native/README.md)；使用 npm 安装前先确认 registry 版本可用。Claude 实机验收尚未完成。

**0.5.0 起，Claude MCP 全新安装默认 `all`（全应用），已有显式白名单不变；已发布 0.4.0 仍是旧默认。** [完整安装指南](docs/claude-native/README.md)包含 MCP 安装、Skill 安装、全应用权限开启与验证步骤，系统/Sky 权限仍需用户批准。

**0.6.0 起推荐 [Claude Plugin 统一安装](docs/claude-plugin/README.md)**：在 `/plugin` 添加 `LonelyFellas/jev-codex-cua` marketplace，安装 `deskhand@deskhand`，MCP 与 `/deskhand:deskhand-access` Skill 一起升级，无需分别安装。`cua_status` 默认离线报告当前版本；显式传入 `checkUpdates: true` 才检查最新版本并提供 Plugin 升级方式，不自动修改配置或权限。实际可用性取决于 npm 发布，Claude Plugin 实机验收尚未完成。旧版手动安装仍兼容，迁移方式见上述指南。

## 安装

```bash
pi install npm:jev-codex-cua
```

在 pi 中执行 `/reload`，然后提出任务：

> 使用 jev-codex-cua，在 Calculator 计算 6 + 7，并读取实际结果确认。

需要 Node.js **22.19+**，已在 pi **0.86.1** 验证加载。使用 `npm view jev-codex-cua version` 查询已发布版本；Git tag 不代表 npm 发布成功。npm 包包含编译产物，无需本地构建。

## 模式与工具

```text
/cua-mode          # 查看当前模式
/cua-mode native   # 直接使用原生工具
/cua-mode jev      # 显式启用 Jev，需要 TYPESAFE_API_KEY
```

| 入口 | 用途 |
|---|---|
| `cua_status` | 查看模式、应用范围和运行时可用性，不检查系统权限 |
| `cua_launch_app` | 0.7.0 起，native 模式按准确注册名称或 Bundle ID 启动任意已安装应用，不需要旧 stateId |
| `cua_get_app_state` | 读取应用、窗口、菜单状态及可用截图 |
| `cua_*` 动作工具 | 点击、拖动、按键、滚动、选择或输入文字 |
| `jev_cua_observe` | 兼容的纯文本观察入口，不调用 Jev |
| `jev_cua_run` | 仅 Jev 模式可用；`dryRun: true` 不执行桌面动作，但仍调用 TypeSafe |
| `/skill:jev-codex-cua` | 加载 Agent 使用说明 |

启动应用不需要旧状态，启动后须观察窗口，不能把启动受理当作就绪。其他原生 UI 动作必须携带同一应用最新状态的 `stateId`，来自 `cua_get_app_state` 或通过完整结构检查的动作返回。它仅可使用一次，在当前 Agent turn 内最多有效 60 秒；再次观察或切换模式会使其失效。动作返回新 stateId 时，检查该状态后可直接继续；否则重新读取。不与其他 Computer Use 通道并行操作。

0.7.1 起，pi 与 Claude MCP 的 **native 不设任务总时长或动作次数上限**；Jev 仍保留本轮 **180 秒/30 次动作尝试**预算。切模式不清零耗时和动作计数。单次调用超时、用户取消、状态时效和授权检查不变。`cua_status` 用 `null` 表示无限制的上限/剩余额度，仍记录耗时、动作数和最近诊断。详见[结果分类、分段耗时与状态复用](docs/native-diagnostics/README.md)。

模式选择保存在当前 pi 会话分支。缺少 Jev 密钥时回退到 native；之后补充密钥不会自动重新启用 Jev。任务运行中不能切换模式。

0.7.0 起，pi native 与 Claude MCP 都支持通用 `state_changed` 恢复：保留剩余预算、作废旧定位，暂停写操作，只允许重新观察同一应用。Agent 核对实际状态后再决定下一步，不自动重放上一次操作；不确定则询问。此逻辑不针对某个产品。安装与实机验收状态见 [启动与恢复设计](docs/claude-launch/design.md)。

## 配置

Native 无需 API Key。需要持久配置时，将私有文件放在**安装包目录之外**，权限设为 `600`，并指定路径启动 pi：

```bash
export JEV_CUA_ENV_FILE=/absolute/path/to/cua.env
pi
```

`cua.env` 示例：

```dotenv
JEV_CUA_MODE=native
# 如需限制应用范围，取消下一行注释：
# JEV_CUA_APP_ACCESS=allowlist
JEV_CUA_ALLOWED_APPS=Calculator
# 仅 Jev 需要：
# TYPESAFE_API_KEY=your-key
```

未指定 `JEV_CUA_ENV_FILE` 时，读取包目录的 `.env.local`，而非当前工作目录。不要提交真实密钥。

### 应用范围

从源码版本 **0.3.1** 起，配置为 native 或未配置模式时默认 `all`；配置为 Jev 时默认 `allowlist`。0.3.0 默认 `allowlist`。已有显式范围设置优先，会话内切换模式不会重新计算应用范围。

保存明确的范围选择：

```text
/skill:jev-cua-access all
/skill:jev-cua-access allowlist
```

向白名单添加单个应用：

```text
/skill:jev-cua-add-app Wechat Devtools
```

优先级：**已保存的 `.access.json` 选择 → 进程环境变量 → 私有配置 → 模式默认值**。附加应用存于独立的 `.apps.json`，原名单保留；两份文件均与配置文件相邻。撤销全应用访问应保存 `allowlist`，不要删除范围文件。

配置文件修改在下一次工具调用生效；进程环境变量修改需要重启 pi；代码更新需要 `/reload`。

## 安全与隐私

- **`all` 只解除插件的应用限制**，不授予 macOS/Sky 权限，也不授权任意任务。官方授权弹窗仍保留，不得绕过受保护界面或已拒绝的权限。
- 发送、购买、删除等后果性操作需要具体授权。网页或截图中的非可信内容不能扩大权限。
- Native 将应用文字及可用截图提供给当前 pi 模型，不调用 TypeSafe，但不代表纯本地或免费。Jev 将文字上下文发送到 TypeSafe，不发送截图；dry-run 也可能产生 API 费用。
- pi 的常规会话记录仍适用。可选的 `fullTrace: true` 需知情确认，仅将一次 Jev 循环写入私有本地文件；轨迹可能包含敏感文字。
- 取消或超时不代表动作没有生效。继续前先读取新状态，不自动重放结果未知的动作。

两种模式在同一 pi Agent 任务内共用一个 Sky 连接。任务结束（包括取消）时关闭本插件的连接并作废旧状态；下一次明确请求桌面操作时才按需建立新连接，仍须通过官方授权，不自动重放上次操作，也不更换会话身份绕过停止状态。`session_shutdown` 保留幂等清理。此生命周期行为适用于 pi，不能据此推断 Claude MCP 的任务结束行为。插件不能保证获取完整应用状态、可靠恢复或生产级自动化。

## 开发

```bash
npm ci --ignore-scripts
npm run check
npm test
npm run test:package
pi install /absolute/path/to/jev-codex-cua
```

测试使用模拟 driver 和 HTTP 响应。实机验证需要明确授权：

```bash
npm run accept:app-access -- --live  # Sky 只读检查，可能打开或聚焦 Calculator
npm run accept:handoff -- --live    # 受控 Calculator 操作
```

PR 和 main 推送运行验证。发布需要在已合入 main 的提交上推送与版本一致的稳定版 `vX.Y.Z` tag，并正确配置 npm Trusted Publisher。不要移动已有版本 tag。

## 更多资料

- [发布流程与 npm 配置](docs/npm-release.md)
- [本地验收证据与限制](docs/local-acceptance.md)
- [固定真实任务基准：执行协议、记录与指标](docs/benchmark/README.md)（源码 checkout 工具，不自动操作桌面）
- [轨迹数据与隐私](docs/action-trace.md)
- [Sky 排查记录](docs/sky-diagnostics.md)

旧版 Codex `cua_repl` adapter 仍保留，但 pi 不需要此入口，且该入口尚未完成端到端验收。

## 许可与致谢

MIT。参考 [Jev-cu](https://github.com/Sac-Y/Jev-cu) 的实现思路，并复用 pi-codex-cua 桥接代码。来源及保留的 MIT/ISC 声明见 [LICENSE](LICENSE)、[NOTICE.md](NOTICE.md) 和 [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)。
