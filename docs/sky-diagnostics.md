# Sky 首次联调：授权请求被忽略

## 已确认根因

Sky MCP 在 get_app_state 前发起 `elicitation/create`，使用**字符串 JSON-RPC ID**，询问 `Allow ChatGPT to use Calculator?`，requestedSchema 是空 object。旧桥接只处理数字 ID，静默忽略了此服务端请求；Sky 一直等待授权回复，客户端最终超时。这不是 Jev API 故障，也没有证据表明官方服务需要重启。

原 pi-codex-cua 的相应客户端有同样的数字 ID 判断，因此其对照读取也不能作为服务端故障的证据。用户在官方 Codex 中连续计算 3+5=8 成功，帮助把排查收敛到桥接差异。

## 实测证据

- initialize/tools/list 正常，约 1 秒内返回 10 个工具。
- 原始协议探测在约 985ms 收到字符串 ID 的 elicitation/create；显式拒绝后约 991ms 返回，未发生读取/输入/点击。
- 修复后的 SkyClient 实际接到 1 次官方授权请求。诊断回调显式 decline，约 3154ms 收到预期拒绝结果，而非超时；没有截图输出。
- 授权通过后的真实 AX 读取仍需在 pi /reload 后由用户确认弹窗验证，不能宣称整个桌面闭环已验收。

## 修复

1. 按 JSON-RPC 规则处理字符串/数字服务端请求 ID，原样回复。
2. 支持 confirmation-only elicitation：官方请求通过独立 pi UI 弹窗交给用户；无 handler、拒绝、非空表单、URL 请求或未知输入不自动放行。
3. 不缓存/伪造官方授权，不替用户永久授权；原任务确认与官方应用授权分开。
4. 等待用户确认期间暂停网络期限，但保留用户取消信号；取消后不发送 accept、不重放动作。
5. 未知服务端方法显式返回 -32601，不再静默挂起。
6. 附带修复：协商原生工具 schema（当前 get_app_state 不支持 disableDiff）、区分超时阶段与用户取消、拒绝不可识别的部分 AX 更新。

类型检查、构建、51 项离线测试通过；测试包括字符串/数字 ID、批准/拒绝/无 handler、未知方法、非空表单、取消和确认等待不消耗网络期限。

## 停止通知与授权误归因修正

后续会话记录出现独立的 `This application session has been explicitly stopped by the user for this turn...` 通知，却被包装成带 `stateId` 的观察结果。现精确识别该独立控制回复为 `session_stopped`，不生成观察 token；AX 页面中引用相同文本不会被当作停止。动作调用遇到停止仍记为结果未知，不重放。

桥接另有两个可离线复现的问题：同一调用中第二个顺序授权请求被直接拒绝；无 UI/不支持的表单被混记为用户拒绝。现做以下区分：

- 每个顺序到达的有效官方确认请求分别交给用户；没有缓存或自动批准。
- 用户选择拒绝才回复 `decline`；无 handler/UI、处理异常、不支持的请求或并发请求回复 `cancel`。
- `approvalReason` 记录 `user_accepted`、`user_declined`、`handler_unavailable`、`handler_error`、`unsupported_request`、`concurrent_request`、`incomplete_request` 或 `caller_cancelled`，不记录授权文案或敏感参数。
- 拒绝/取消在同一调用内保持，后续请求及迟到的确认结果不能覆盖它。授权尚未完成时提前到达的工具结果也不能成为可用观察。

这些是协议夹具与源码证明的问题，**不能据此认定历史停止一定由桥接触发**；仍需真实运行中的脱敏 `approvalReason` 判断。无 UI 时不会自行授予权限。

## Native 限制收窄

- native 可复用同一进程返回的完整、未截断 AX 树，不强制要求同时有截图；坐标操作仍要求该次状态带截图。Jev 接管及 MCP 的原复用条件不变。
- native 纯观察的 `no_windows_available`、传输错误或单次调用超时，不再额外设置应用启动禁令。不会自动启动或重试；此前的停止/拒绝/未知动作禁令不会因此清除。
- 官方授权、应用范围、取消、串行调用、单次调用超时、60 秒单次状态 token 和 `state_changed` 重新观察要求仍保留。native 不启用 Jev 总预算或置信度门禁。
- 未完成官方原生实现的行为对照，因此不宣称已与官方体验完全一致；状态时效、超时和恢复约束不在此次未经验证地移除。

## 排查历史与纠正

早期只看到 get_app_state 超时，曾检查权限日志、服务进程与不可见的授权弹窗，并在用户允许后重启服务。重启未解决问题；后续证据表明授权发生在 MCP 回调而非服务自己的可见窗口中。不能把 TCC 成功、进程存在或没有窗口等同于应用授权链完整。
