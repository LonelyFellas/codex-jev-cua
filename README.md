# jev-codex-cua

> **v0.3.0 实验原型**：用于保存当前实现和联调证据，不代表达到官方 Codex Computer Use 的可靠性。已验证部分计算器任务；多步任务、浏览器控件和菜单状态仍有兼容性缺口。不要将单元测试通过视为任意应用可用或生产验收通过。

**一个 pi 包，两种模式，共用同一套 Codex/Sky 桥接。** 默认 `native`，不需要 TypeSafe Key；显式选择 `jev` 后才使用参考 [Sac-Y/Jev-cu](https://github.com/Sac-Y/Jev-cu) 的文字决策循环。

```text
native（默认）：pi 主 Agent → cua_* 原生工具 → Codex/Sky
jev（可选）：   pi 主 Agent → Jev 决策/策略 → 同一个 Codex/Sky
                                     └ 不确定时交回主 Agent，不自动重放
```

不依赖自研原生引擎。优先支持 **pi 插件**，通过复用 pi-codex-cua 的 MIT 桥接代码连接已安装的 Codex/Sky；不需要切换到 Codex 会话或使用 `cua_repl`。原 Codex driver 仍可用于独立脚本。来源及授权情况见 [NOTICE.md](NOTICE.md)。

## 开发

Node >=22.19，TypeScript 严格模式。pi 插件已在 pi 0.86.1 验证加载；pi 核心包和 typebox 为宿主 peer dependencies。核心编排库只使用 Node 内置模块。

```bash
npm ci
npm run check
npm run build
npm test
# 可选，需用户明确允许真实计算器操作；官方批准不会被模拟：
# npm run accept:handoff -- --live
# 可选，真实 Sky 只读验证应用范围（可能打开/聚焦 Calculator，保留官方授权）：
# npm run accept:app-access -- --live
```

测试使用模拟 driver 和 HTTP 响应，不访问外网、不控制真实应用。原生引擎实验留在独立 `native-mvp` worktree，不属于本版。

## 自动发布与 npm 安装

推送已合入 `main` 的 `vX.Y.Z` tag 后，GitHub Actions 检查版本一致性、运行发布门禁并通过 npm OIDC 发布；普通 PR / main 推送只验证。首次须绑定 npm Trusted Publisher，配置与操作见 [npm 自动发布](docs/npm-release.md)。

目标分发形式遵循 [pi 官方包规范](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)：

```bash
pi install npm:jev-codex-cua
# 固定版本：pi install npm:jev-codex-cua@0.3.0
```

以 npm registry 实际可查询的版本为准。包包含源码与预构建产物，具备 prepack 构建及隔离安装检查；本项目采用 MIT，引用部分保留 ISC/MIT 声明，见 [LICENSE](LICENSE) 与 [第三方授权](THIRD_PARTY_LICENSES.md)。发布门禁、版本固定和配置迁移见 [npm 分发](docs/npm-release.md)。npm 安装后无需本地编译；密钥和授权配置应放在包外，通过 `JEV_CUA_ENV_FILE` 指定。

## 在 pi 中本地安装使用

```bash
cd /absolute/path/to/jev-orchestration
npm ci --ignore-scripts
npm run check
pi install /absolute/path/to/jev-orchestration
```

这是本地路径安装，不复制代码。然后在 pi 执行 `/reload` 或打开新会话。不要运行下面的 Codex skill 安装命令来代替 pi 安装。

- `/cua-mode`：查询模式；`/cua-mode native` 或 `/cua-mode jev` 显式切换，不执行桌面动作。
- `cua_status`：查看模式、插件应用范围（`appAccess`）、配置及原生接管剩余预算；不代表系统权限已授予。旧 `jev_cua_status` 和 `/jev-cua-status` 保留兼容。
- `cua_get_app_state`：读取原生窗口/菜单状态和可用截图；其他 `cua_*` 工具由主 Agent 直接操作，不调用 Jev。
- `jev_cua_observe`：兼容的纯文本观察入口，不调用 Jev；原生动作前仍需 `cua_get_app_state` 的 stateId。
- `jev_cua_run`：**只在 jev 模式启用**，默认执行已授权短任务，`dryRun:true` 为预览。会把文字候选及上下文发送到 TypeSafe，可能计费。原生模式下即使直接调用这个工具也会拒绝，不能隐式启动 Jev。
- `/skill:jev-codex-cua`：加载 pi 使用流程。
- `/skill:jev-cua-access all` 或 `/skill:jev-cua-access allowlist`：用户显式切换插件应用范围，不读取密钥，不操作桌面。需要已加载 0.3.0 或更高的支持版本。

可在 pi 中说：

> 使用 jev-codex-cua，在 Calculator 计算 6 + 7，并读取实际结果确认。

明确的任务请求授权其相关低风险步骤，不等于授权其他应用或删除、发送、购买等额外操作。需要预览时再明确要求 dry-run，不必每次先预览。

Sky 仍可能发出 **“官方 Computer Use 授权”** 弹窗，由用户决定；插件不伪造批准或绕过它。等待官方确认时暂停网络期限，Esc 仍可取消。无 UI 时若官方请求授权就拒绝，而不是自动接受；若官方无需新授权，普通 observe/run 无需插件弹窗。完整轨迹仍须交互确认。

### 模式与原生操作

```text
/cua-mode native
/cua-mode jev
```

默认 native；可用 `JEV_CUA_MODE=native|jev` 设置会话初始值。用户通过命令做的选择保存在 pi 当前会话分支，reload 恢复。缺少/丢失 Jev Key 时转 native，不发送请求；之后补 Key 不会偷偷重新启用 Jev，必须再次显式选择。运行中拒绝切模式，先等待或正常取消。不提供模糊任务分类或 auto 模式。

原生工具：`cua_list_apps`、`cua_get_app_state`、`cua_click`、`cua_drag`、`cua_perform_secondary_action`、`cua_press_key`、`cua_scroll`、`cua_select_text`、`cua_set_value`、`cua_type_text`。前缀避免覆盖 pi-codex-cua 的同名无前缀工具。

`cua_get_app_state` 返回 stateId。动作必须带同一应用的 stateId；它在当前 agent turn 内最多有效 60 秒，一次动作尝试后即消费。模式切换、另一次观测、异常或 agent 结束会清理旧状态。优先使用该快照里的元素编号；坐标动作必须有本次返回的原生截图。原生观察接受菜单/弹窗/部分状态，不强制 standard window 根；不能将局部状态误称为完整页面。stateId 并不保证界面原子性，操作后仍要重新读取验证。

Jev 对目标不确定时返回 needs_planner，交回主 Agent。仅此结果在当前 turn 内开放**原应用、剩余预算范围内**的原生动作；主 Agent 先读取新状态，再作独立判断，不自动重放 Jev 动作。原生接管消耗剩余预算，错误、agent 结束或新 Jev 任务会清理它。`confirm`/取消/未知结果不启用这个接管通道。

Native 的判断与后果性操作授权由主 Agent 负责，不使用 Jev 的置信度/关键词分类；两者都经过插件应用范围、官方授权和状态检查。用户显式切模式不代表可以绕过拒绝或扩大任务授权。

### pi 配置

扩展自动读取**包目录**的 `.env.local`，不是启动 cwd 的任意环境文件。密钥只在内部使用，不写进 process.env 或 Sky 子进程，不在工具参数和结果里传递。

```dotenv
JEV_CUA_MODE=native
JEV_CUA_APP_ACCESS=allowlist
JEV_CUA_ALLOWED_APPS=Calculator
# 只有 jev 模式需要：
# TYPESAFE_API_KEY=your-key
```

文件必须属于当前用户，权限为 `600`，已被 Git 忽略。也可使用进程环境的 `TYPESAFE_API_KEY`；使用 `JEV_CUA_ENV_FILE` 指向其他私有文件。基础白名单遵循环境变量优先于文件，默认允许 Calculator。新增应用也可通过下面的专用 skill 单条追加，不必编辑含密钥的文件。普通桌面任务不得自行扩展名单。

### 通过 Skill 切换应用范围（推荐）

在 pi 中主动调用：

```text
/skill:jev-cua-access all
# 恢复已有白名单：
/skill:jev-cua-access allowlist
```

明确调用即授权这次配置变更，不会重复询问同一授权。Skill 先检查当前 `cua_status` 的配置路径与能力，再调用本安装的专用脚本，最后确认有效 `appAccess` 与用户选择一致。它不打开/回显密钥，不改 `.env` 或原名单，不自动开始桌面任务。

选择存于 `<envFile>.access.json`（默认 `.env.local.access.json`），由原子写入保护，权限为 600。重复选择不重写；异常文件、符号链接或锁冲突会停止，不强行修复。授权文件、锁和临时文件均不打包。

**优先级：显式授权文件 > 进程环境 `JEV_CUA_APP_ACCESS` > 私有环境文件 > `allowlist`。** 因此 Skill 的 `allowlist` 能覆盖环境里残留的 `all`；无授权文件时保持原优先级。不要通过删除授权文件来撤销，否则可能恢复环境里的全应用访问。

`cua_status` 新增 `appAccessFile`（授权文件绝对路径）与 `appAccessSource`（`grant-file` / `environment` / `env-file` / `default`）。缺少这些字段或 Skill 脚本路径与当前插件不一致时，不写文件、不误报成功。先 `/reload`，仍不支持再使用 `pi install npm:jev-codex-cua@<已发布的支持版本>` 并用 `pi list` 核对；`pnpm install` 不会更新 pi 管理的插件。不得猜测未发布的版本号。

### 手动配置（兼容入口）

尚未保存独立授权文件时，用户也可将私有配置中的 `JEV_CUA_APP_ACCESS` 设为 `all`：

```dotenv
JEV_CUA_APP_ACCESS=all
```

- 缺省为 `allowlist`，仅允许基础名单和 `.apps.json` 中的应用；`all` 适用于 native、兼容文本观察和 Jev，不必逐个追加应用。不接受 `*`、`true` 等代替值，配置错误时拒绝执行。
- 手动配置来源中，环境变量优先于 `.env`；若 `appAccessSource=grant-file`，应使用 Skill 切回 `allowlist`，手动环境设置不会覆盖已保存的选择。两种方式都保留原基础/附加名单。
- 配置每次工具调用重读：私有文件改动在下一次调用生效；进程环境改动需要重启 pi。首次更新代码需 `/reload`。配置变更不主动中断正在执行的 Jev 循环，需中止时请正常取消任务。
- 动作仍指定一个具体应用名、bundle ID 或 `.app` 路径，不能传通配符。应用范围不等于任务授权，普通桌面任务或网页内容不能让模型自行启用 `all`。
- `cua_list_apps` 保持现有的应用身份发现能力，名单模式也可使用；列出应用不代表已获得读取其窗口或执行动作的权限。

**三个独立层次：**

| 层次 | 本插件行为 |
|---|---|
| macOS 权限 | 由实际控制进程申请辅助功能、屏幕录制等权限；当前复用官方 Sky 进程链。Apple Events 可能还需要按目标应用授权。本开关不授予这些权限。 |
| 插件应用范围 | `allowlist/all` 决定哪些具体应用能通过插件检查；不修改官方授权。 |
| 操作确认 | 已授权的普通读取、点击、导航不额外逐次确认。native 仍由主 Agent 获取后果性操作的具体授权；Jev 的敏感动作门禁保留。全应用访问不授权任意发送、付款或删除。 |

当前检查到的 Sky 工具目录未公开全应用授权或关闭官方确认的接口，不能保证“首次系统授权后所有应用永久免确认”。状态中的 `officialApproval=runtime-controlled`、`systemPermissions=not-checked` 明示此边界，`runtimeAvailable` 仅表示运行时路径可用。密码、安全提示、受保护界面及官方拒绝不能绕过。接口核查记录见 [应用访问需求](docs/app-access/requirements.md)。

### 只添加应用的 Skill

首次更新后执行 `/reload`，然后可明确授权单个应用：

```text
/skill:jev-cua-add-app Wechat Devtools
```

它只追加指定应用，不删除/重置名单，不读取或修改 API 密钥，不联网、不启动应用，不修改系统/Codex 原生权限。普通的“帮我操作某应用”或白名单错误，不自动触发新增授权；用户必须明确要求添加。

专用脚本也可手动使用：

```bash
npm run allow-app -- 'Wechat Devtools'
```

新授权写到独立的 `.env.local.apps.json`；配置了 `JEV_CUA_ENV_FILE` 时，路径为该环境文件名加 `.apps.json`。在 `allowlist` 模式下，有效名单是原基础名单与该授权文件的并集；即使环境变量覆盖基础名单，明确的附加授权仍生效。两份文件不会互相覆盖。授权文件权限为 600，重复添加不改文件；拒绝批量、通配符、删除/替换模式、符号链接和异常配置。更新使用独占锁及原子替换；遇到锁冲突停止，不擅自删除锁。

运行时每次调用重读名单，完成首次代码 `/reload` 后，追加应用无需再次重载。本 skill 不提供撤销权限功能，撤销须另行明确处理。默认授权文件同样被 Git 忽略且不打包发布。

`verify` 在 pi 工具中为 `{role, labelEquals}`：对重新读取的 AX 元素完整标签做精确匹配，不能执行 JS。例如先从 observe 确认计算器结果的实际文本格式，再设置对应标签；不要猜 `Value:` / ID / 本地化格式。

**数据去向**：native 将 AX 和原生截图提供给当前 pi 主模型，不调用 Jev，但不等于纯本地或没有主模型费用。native 文本最多 50 KB/2000 行；兼容文本观察及 Jev 结果最多 20 KB/400 行。Jev 不接收截图。

插件默认不额外写完整轨迹；`jev_cua_run(fullTrace:true)` 经知情确认后只记录这一次 Jev 循环，原生接管不会悄悄续写该文件。native 工具使用 pi 正常的会话记录（可能含截图），应按 pi 设置管理；不能把“没有 fullTrace 文件”理解为会话不留存。日志文件为 600、目录为 700，可能敏感，不自动上传。详见 [完整动作轨迹](docs/action-trace.md)。

原生和 Jev 共用连接、串行锁和官方授权。切勿同时使用其他 Computer Use 通道操作同一桌面。可以与 pi-codex-cua 共存，但同一包的新旧安装来源要去重，避免 `jev_cua_*` 兼容名称重复注册。

Sky 仍要求官方运行时及其权限，支持原来的 `PI_CODEX_CUA_CLIENT` / `PI_CODEX_CUA_CODEX` / `PI_CODEX_CUA_SERVICE` / `PI_CODEX_CUA_SOCKET_DIRECTORY` / `PI_CODEX_CUA_RESOURCES` 路径覆盖。不会绕过系统提示、应用授权、屏幕锁定或站点限制。取消或超时会关闭连接，不自动重试写操作；已派发动作可能已生效。首次联调的授权回调问题及修复证据见 [Sky 排查记录](docs/sky-diagnostics.md)。

## 在 Codex cua_repl 中使用（可选旧入口）

1. 配置 Codex Computer Use 及其 macOS 权限。
2. 在运行时环境设置 `TYPESAFE_API_KEY`。本项目不自动读取 `.env.local`，不把 key 写进源码；也可通过 `jevOptions.apiKey` 从安全的外部来源传入。
3. `npm run build`。
4. 首次在 `cua_repl` **单独**执行 `await cua.getApp("Calendar")` 并阅读当前接口文档。此 adapter 按参考项目的 `getAXState/click/setValue/typeText/pressKey/scroll` 契约编写；如果本地接口不同，停止并适配，不能猜。
5. 在后续调用导入编译产物，默认先预览：

```js
var deskhand = await import((await import("node:url")).pathToFileURL(
  "/absolute/path/to/deskhand/dist/index.js"
).href);
var driver = deskhand.createCuaDriver(cua);
var result = await deskhand.runTask({
  driver,
  appName: "Calendar",
  goal: "Switch to the previous month",
  allowedApps: ["Calendar"],
  dryRun: true,
  maxSteps: 2,
  emit: line => nodeRepl.write(line + "\n"),
});
nodeRepl.write(result);
```

**dry-run 不执行桌面动作，但会把候选文字和上下文发送到 TypeSafe，并可能产生 API 费用。** 不发送截图不代表没有隐私风险。日志默认不写盘。

真实执行需要用户授权，把 `dryRun` 改为 `false`，并尽量提供从当前 AX 确定的 `verify(ax)`。例如翻月任务应匹配**目标月份的显示值**，不能只检查“下一月”按钮存在。不能复用示例假定的月份或元素编号。

TypeSafe 合成样例 3/3 通过。实际计算器已完成并读取确认 12+3232=3244、323423×323244=104544544212；12+30232 的早期尝试曾失败。Music 已能提交搜索词，但上次最终读取被用户取消，尚未确认匹配结果。新单包双模式另已实测 native 的 6+7、真实 Jev 的 12+30232，以及明确含模拟的受控实机接管链路。测试边界和仍未覆盖项见 [本地验收](docs/local-acceptance.md)，不能据此宣称超过官方 Codex。Codex cua_repl 旧入口未联调，不把模拟测试当作桌面验收。

## 核心 `runTask()` 参数（pi 工具提供受限子集）

| 参数 | 说明 |
|---|---|
| `driver` | `createCuaDriver(cua)` 或自定义 Driver |
| `appName`, `goal` | 应用名和单阶段目标；建议英文目标 |
| `allowedApps` | 推荐每次显式只允许目标应用；默认沿用参考项目的 7 个应用名 |
| `dryRun` | 核心 `runTask()` 默认 `true`；pi 工具默认 `false`，只有明确预览才传 true |
| `maxSteps` | 默认 30，上限 100 |
| `candidateMax` | 默认 40，上限 200 |
| `resources` | `{text, key, direction}`，或无副作用的 `(step, decision) => resources`，每步最多调用一次 |
| `plan`, `constraints` | 主 agent 提供的计划及约束，不作为持久化任务进度 |
| `verify` | 只读验证函数；传入全量 AX，返回 boolean |
| `decide` | 注入替代决策函数，用于离线测试 |
| `jevOptions` | apiKey、model、HTTPS endpoint、单次超时（默认 20 秒）、HTTP 重试上限（默认 2） |
| `traceDir` | 显式配置才写本地 JSONL，返回 `tracePath`；pi 的 `fullTrace` 使用包目录 `runs/`，不接受模型指定任意目录 |
| `traceMode` | 默认 `metadata` 不保存 AX/目标原文/文本资源；`full` 保存完整文本轨迹，必须有 `traceDir` 和用户知情同意。两者均排除 API 密钥 |
| `verifySpec` | 可选的声明式验证说明，用于轨迹记录；不替代 `verify` 的实际验证函数 |
| `emit` | 接收不含界面正文的进度字符串；默认不输出 |
| `plannerHandoff` | pi 默认启用；将目标不确定/输入目标或焦点不匹配交给主 Agent，包含剩余预算。核心库默认仍返回原有 stop/escalate |

默认应用名单：Calendar、Calculator、TextEdit、NetEaseMusic、Figma、Google Chrome、Codex In-app Browser。白名单不是对这些应用的所有操作授权。

## 动作与状态

- `click_element`：当前候选索引点击。
- `set_value`：对可编辑角色设置显式文本，允许显式空串清空。
- `type_text`：当前选中元素必须等于 AX 报告的焦点；不自动发送。
- `press_key`：必须显式给 key，并绑定当前焦点。仅导航键可自动放行，Return 和快捷键交回人工/主 agent。
- `scroll`：显式给 up/down/left/right，每次一页。
- `wait`：等待 500ms 后重读。
- `click_at`、`drag`：可由 planner 给坐标用于预览，但总是请求确认和接管，不自动执行。
- `ask_user`：停止并请求确认。

| 返回 status | 含义 |
|---|---|
| `dry_run` | 返回计划，没有执行动作 |
| `done` | `verify` 已通过，`verified: true` |
| `model_done` | 仅模型声称完成，未通过确定性验证 |
| `confirm` | 敏感操作、模型风险、特殊按键或坐标操作，需接管 |
| `needs_planner` | pi 的目标不确定/目标类型或焦点问题，交给主 Agent 判断，附 handoff 上下文与剩余预算；不自动重试 |
| `escalate` | 其他信息不足、状态变化、连续无变化等；核心库未启用 plannerHandoff 时也用它返回低置信度 |
| `stop` | 应用不允许或置信度过低 |
| `max_steps` | 动作预算耗尽，任务未确认完成 |
| `error` | bind/observe/decide/execute/verify 等阶段失败，查看 `reason`；不回显可能含敏感信息的底层错误正文 |

`steps` 是已返回成功的动作调用数（含 wait），不是业务成功数。`outcomeUnknown: true` 表示动作派发或后续观测异常，不能假定什么都没发生。先读新状态，禁止自动重跑整段任务。

## 相对参考项目的小改动

保留 AX 筛选、四问、driver 注入和循环结构，未新增编排框架：

- TypeScript 类型覆盖公开接口及动作参数。
- Calculator 按钮点击恢复参考项目的 0.40 目标置信度门槛；其他应用/动作仍为 0.50，敏感标签与风险检查先执行，不受此门槛放宽影响。
- 最近操作使用当时的按钮语义和前后可见文本，不把旧元素编号当作稳定身份；仅显式开启完整轨迹时会保存这些模型输入。
- 应用白名单先于读取；执行前再取全量 AX，变化则停止。
- 策略与执行使用同一份已准备动作，坐标不能覆盖元素目标。
- 不默认填入空文本或 Return；输入焦点不匹配时停止。
- 完成概率与实际验证分开报告，概率缺失/越界不放行。
- 动作永不自动重试；只读瞬时错误和特定 HTTP 错误有限重试。
- 记录默认关闭，支持原有元数据日志和显式同意的完整文本轨迹；不自动安装 skill。

这些保护不构成完整安全保证。AX 两次一致不保证界面原子性；模型分数未经校准；敏感词无法识别所有危险语义。敏感操作必须交给用户或主 agent 独立审查，不能通过改阈值、白名单或伪造决策绕过。不要并行运行多个 driver 或混入其他 CU 调用。

## Skill 与在线评测（手动启用）

```bash
npm run install-skill       # 可选旧 Codex 入口，写入 ~/.codex/skills/deskhand；pi 不需要此命令
npm run uninstall-skill     # 仅卸载属于当前 checkout 的安装
npm run eval               # 默认拒绝网络调用，显示启用说明
npm run eval -- --live      # 需要 TYPESAFE_API_KEY；会向 TypeSafe 发送合成样例并可能计费
```

如使用本地环境文件启动评测，可在构建后运行 `node --env-file=.env.local dist/eval.js --live`。不要提交真实密钥。

评测只检查少量合成 AX 样例的目标及动作选择，不证明端到端桌面成功率。不写死价格，API usage 原样返回。外层 cua_repl 超时应覆盖全部观测和 HTTP 重试预算；本项目不能可靠取消已派发原生动作。

## 当前已知限制

- Jev 仍按总目标逐轮选择动作，没有可靠的结构化任务进度管理；曾在计算器任务中耗尽预算而未完成。
- AX 候选解析依赖角色和标签，Music 已发现并修复可选行和 search text field 漏识别，其他控件仍可能遗漏。
- Chrome 管理后台联调中，实际页面已经跳转，Sky 却持续返回侧栏子菜单而非完整页面。Jev 的 full-tree 校验会拒绝此类结果；新 native 模式直接返回菜单，不加这一拒绝，但不保证 Sky 会返回完整页面。复杂表单与批量发布仍未验收。
- `needs_planner` 提供交接上下文和剩余预算，不是保证自动恢复的执行器；敏感操作、取消或未知结果不能被自动重放。
- 本机 Codex/Sky 为私有运行时，版本变化可能影响协议和授权。插件不包含这些二进制，也不绕过其授权。

该版本保存了工作代码和失败证据。尚未完成的后台创建/发布测试，不记录为成功。

## 文件结构

```text
src/       AX、Jev、策略、driver、循环、pi 扩展、Sky 桥接、配置、日志及入口
skills/    pi 的 jev-codex-cua skill
skill/     可选旧 Codex skill 模板
fixtures/  合成候选评测样例
test/      离线回归测试
docs/      需求与设计
```
