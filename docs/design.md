# 技术设计

## 模块

- types.ts：AX、决策、动作判别联合、driver、任务结果契约。
- ax.ts：解析 Sky 风格的全量 AX 文本；候选按角色和目标相关度排序。
- jev.ts：TypeSafe System One 客户端；按候选 ID 归一化响应，拒绝无效概率/动作。
- policy.ts：纯函数检查应用、概率、目标及完整动作参数，返回 proceed/confirm/escalate/stop/model_done。
- cua-driver.ts：注入 cua 对象，无私有模块 import；getAXState({emit:false,disableDiffing:true})。
- loop.ts：单 driver 排他执行，应用白名单先于 bind/observe；默认预览；执行前再次读全量 AX，发生变化交回 agent；不自动重试动作；动作之后必读状态。
- trace.ts：默认关闭；原 metadata 模式只保留步骤、动作类型、索引、门槛代码、耗时和状态。显式 full 模式保留快照、真实决策输入/回答、动作派发及结果。文件 600、目录 700、凭证脱敏；记录失败停止任务，返回 traceIncomplete。详见 action-trace.md。
- install-skill.ts / eval.ts：显式安装入口与需要 --live 的在线候选评测。

## pi 接入（新增已授权范围）

提供 TypeScript 扩展与 pi manifest，旧三个工具 jev_cua_status / jev_cua_observe / jev_cua_run 保留兼容；双模式新增通用状态入口和十个 cua_ 原生工具。默认只允许 Calculator；用户可通过 JEV_CUA_ALLOWED_APPS 设置应用名单。密钥从进程环境或扩展目录的 .env.local 读取，也可用 JEV_CUA_ENV_FILE 显式指定，不写进工具参数或 process.env。

pi 不提供跨扩展执行已注册工具的公开 API；复用 pi-codex-cua 的 MIT Sky MCP 桥接代码并保留 LICENSE，Deskhand 独立持有会话连接，不改上游，也不注册重复的原始 CU 工具。仅在需要观测/执行时启动桥接，取消/超时/会话关闭即停止连接，不重放动作。

工具执行串行；与原始 CU 调用不可混用。pi 普通 observe/run 不再弹额外任务确认；用户明确的任务请求授权相关低风险步骤，pi 默认执行，dryRun:true 才预览。官方 elicitation 仍转交用户，无 UI 时拒绝该官方请求而非自动接受。observe 只返回有界 AX，不返回截图。图片不会发送给 Jev。run 可显式选择 fullTrace，确认框披露界面文字及输入/决策内容的本地持久化；缺省不保存完整轨迹。工具只支持声明式 role + labelEquals 验证，不执行模型生成代码。取消信号传递至循环、HTTP 和原生桥接；已派发操作不能保证撤销。

## 运行

Node >=22.19，ESM，tsc 输出 dist。Codex cua_repl 导入 dist/index.js 后创建 driver 并调用 runTask。首次由用户/agent 确認本地 cua API 文档；不匹配即停止，不猜 API。

Jev 密钥由显式 apiKey 或 TYPESAFE_API_KEY 提供；不自动读取文件，用户可用 Node --env-file 或运行环境注入。模型默认 jev-latest；不写死未经核验的价格。

## 单条应用授权 Skill

`skills/jev-cua-add-app` 只接受用户明确指定的一个应用。`src/add-app.ts` 调用 `app-grants.ts`，在 `<envFile>.apps.json` 追加授权，不读取凭证文件或启动桌面进程。运行时将基础环境白名单与追加列表取并集；不支持从该 helper 删除、替换或批量放行。

文件权限 600，拒绝符号链接/异常结构，独占锁保护读改写，临时文件原子替换。重复条目无变更，锁冲突直接失败。管理权限只来自本次用户明确追加请求，普通任务不能自行调用以绕过白名单。

## 单包双模式

- `cua_` 前缀的 10 个原生工具对接同一个 SkyClient；`cua_status` 为通用入口，旧 `jev_cua_status` 保留兼容。
- 默认 native。`/cua-mode` 查询，`/cua-mode native|jev` 为用户切换命令，可通过 JEV_CUA_MODE 设置初始选择。选择保存在 pi 会话自定义条目，不持久化密钥；reload 恢复当前分支选择。
- 工具可见性按模式调整并保留其他扩展的 active tools。工具内部也校验模式，不能靠调用隐藏的 jev_cua_run 启动 TypeSafe。缺 Key 转 native；配置补齐不自动反向切换。
- Native 的 get_app_state 直接返回有界 AX 和原生截图（菜单根也合法），生成单次 stateId。动作要求相同应用、当前 turn、未消费且未过期的状态；每次动作/模式切换/其他观测失效旧状态，不新增 UI 确认。
- 两种模式共享一个延迟启动的客户端、串行锁和官方授权回调。运行 Jev 清理 native 状态；不能并发两条 CU 路径。
- 只有 needs_planner 结果允许本轮主 Agent 用原生动作接管，绑定原应用、目标与剩余预算；不从 confirm/error/cancelled 自动切换。接管只开放工具，不自动执行动作。模式切换中若仍有运行任务则拒绝，先正常取消。
- Native 不沿用 Jev 的目标置信度/关键词决策层，由主 Agent 在用户明确任务范围内决策，仍遵守后果性操作授权与官方系统限制。这不是绕过 Jev 拒绝结果的自动通道。
- 不增加自动任务复杂度分类、隐藏模型路由或第二套安装包。

## 主 Agent 交接

pi 启用 plannerHandoff；core 库默认保持兼容。仅目标置信度低、输入目标类型/焦点不匹配等低风险原因返回 needs_planner，附原目标、当前状态摘要、候选、最近已完成历史和 remainingSteps。主 Agent 先读取核验，或在原授权范围内细化下一子目标；不自动重试、不得重置预算。不伪造 Jev 置信度。双模式版本允许该结果在原应用和剩余预算内开放 native 工具给主 Agent 独立判断，必须重新观察；模式仍为 jev，动作来源标为 main_agent。风险/敏感命中仍返回 confirm；拒绝、取消及未知结果不转成自动接管。

## 安全与可靠性取舍

策略基于原始完整标签和最终动作，模型的目标标签不被信任。资源不允许覆盖已选元素。type_text 要求 AX 报告目标正是当前焦点；press_key 要求同样的目标绑定，非导航按键请求确认。set_value 必须有显式文本和可编辑角色。坐标/拖拽需要人工接管。

风险确认是终止结果，不提供通用 bypass 或自动确认开关；敏感操作由上层审查后在独立 CU 调用中执行，再用新状态启动任务。

文本两次一致不保证界面原子性；Codex 执行层仍管理元素有效性。默认最多 30 步和连续 3 次无变化退出。没有任务级强制超时取消原生动作，避免假装取消已派发操作；外层超时后必须重新观察，不能重试整段脚本。
