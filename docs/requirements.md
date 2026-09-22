# Deskhand 第一版需求

## 已确认方向

参考 https://github.com/Sac-Y/Jev-cu （阅读版本 e2cc92d731fac6e6aeb7acbd3c105cf23552cdec），先实现相近的功能，不重写桌面底层，不以“超过参考项目”作为本次交付声明。

使用 TypeScript 严格类型。Jev / TypeSafe 负责文字候选决策，Codex Computer Use 负责观测和执行，主 agent 提供目标、计划、输入资源及结果验证函数。

## 范围

- AX 文本解析、角色归一化、候选排序、精简上下文。
- Jev System One HTTP 客户端，target/action/done/risk 四问，超时、有限 HTTP 重试、响应校验。
- 可注入 driver/decider 的任务循环，默认 dry-run，明确应用白名单，步数预算。
- 元素点击、设置值、输入、按键、滚动和等待。坐标点击与拖拽仅生成预览并请求接管，不让未校验坐标绕过元素策略。
- 本地敏感动作门槛、低置信度停止/升级、错误停止，不重放写操作。
- 每步后全量观测，支持 verify；未通过确定性验证的模型完成声明标注为 model_done，而非 verified done。
- 可选 JSONL 元数据执行记录（不记录 AX、输入文本、目标原文或密钥）。新增显式同意的 fullTrace 完整轨迹用于定位失败：每步 AX、候选、模型输入/回答、策略、实际 driver 调用和结果均可追溯，不记录密钥/截图；不改变门槛、预算或任务推进逻辑。
- Codex cua_repl 适配器、可手动安装的 skill、离线测试、需显式启用的在线候选评测。

## 边界

新增已授权范围：以 `jev-codex-cua` 为插件名提供 pi 扩展、Skill、Sky driver、密钥加载和取消/会话清理。复用 pi-codex-cua 的 MIT 桥接代码，保留原 Jev-cu 编排，不依赖 pi 内存在 cua_repl。默认只允许 Calculator。按用户最新要求，pi 中明确授权的普通任务不再逐次确认，默认直接执行，dry-run 可选；保留官方授权与完整轨迹知情确认。Jev 犹豫通过 needs_planner 将当前状态和剩余预算交回主 Agent，不能伪造批准、无条件放行敏感动作或扩大任务。

本次仍不做 MCP 服务、多模型配置、自研原生引擎或 GUI。原 Codex cua_repl 入口尚待目标环境验证。文本候选会发送到 TypeSafe，dry-run 不等于离线。应用白名单、敏感词和模型风险分数不是完整安全边界。

用户已自行完成 TypeSafe 合成样例在线评测（3/3），这不等于授权任意后续 API 调用或桌面操作。开发验证默认离线；pi 本地安装按当前任务授权进行，不修改系统权限、不执行真实应用写入、不提交或推送。原 native-mvp worktree 保留不变。

## 单包双模式（用户已确认）

保留一个 npm 包和同一套 Sky 桥接。新增默认 native 模式：主 Agent 通过前缀 cua_ 的原生工具操作，不依赖 TypeSafe Key，不调用 Jev；保留显式 jev 模式供文字决策循环使用。用户用 /cua-mode native|jev 切换，切换不执行桌面动作、不自动发送界面数据。

缺少 Jev Key 时留在/回到 native，配置密钥后也不偷偷开始 Jev 请求；用户再次显式选择 jev。Jev 不确定时交给主 Agent，原生接管限制在原应用与剩余预算内，不重放旧动作；敏感确认/取消/错误不触发自动接管。官方授权保持正常处理，不伪造接受。

Native 接口接受菜单/弹窗的真实 Sky 结果及可用截图，不再要求只有 standard window 才能观察。每次动作仍需新状态，模式切换、错误和会话结束会清理旧索引。两个模式工具互不冲突，也不覆盖已有 pi-codex-cua 的无前缀工具。

现有本地安装与密钥文件不自动迁移；本轮先做代码与 npm 产物验证，不自动发布。

## 验收

TypeScript 检查、构建、Node 离线测试通过。用模拟 driver 覆盖完整 observe→decide→policy→execute→observe→verify 闭环、dry-run 无动作、非白名单零读取、敏感动作拦截、参数完整性、旧观测拒绝、异常停止、最后一步验证及轨迹隐私。在线 API 与真实桌面结果单独标明，不能用模拟测试替代。
