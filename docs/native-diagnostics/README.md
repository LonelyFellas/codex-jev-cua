# 原生调用诊断、状态复用与硬预算

## 结果不是一个布尔值

原生工具的 `details.diagnostic` 与 `cua_status.lastDiagnostic` 包含：

| 字段 | 含义 |
|---|---|
| actionOutcome=not_dispatched | 本地校验/预算/桥接预检阻止派发 |
| actionOutcome=call_returned | 动作 RPC 正常返回，不代表目标达成或实际界面一定改变 |
| actionOutcome=unknown | 动作可能已执行，但未取得可靠的成功返回；禁止自动重试 |
| actionOutcome=not_applicable | 只读调用，不涉及动作 |
| observationOutcome=available | 有可使用的状态与 stateId |
| observationOutcome=not_reusable | 有返回但不足以安全签发下一动作状态；须显式观察 |
| observationOutcome=unavailable | 观察不可用或调用失败 |
| observationOutcome=not_attempted | 尚未进入观察/桥接阶段 |

错误以 `CUA diagnostic: {...}` 结构化文本和 Error 的 diagnostics 属性输出，不回显服务任意错误正文。code= `no_windows_available` 只说明服务返回了该错误，**不证明 Escape 未执行，也不证明窗口关闭成功**。当 Sky 把动作与后续取状态封装在一个 RPC 内时，本插件无法从错误拆出隐藏的动作收据。

Jev `runTask` 结果增加 `diagnostic`：当 driver 动作调用返回成功、但后续独立 observe 失败时，保留 `actionOutcome=call_returned` 和 `observationOutcome=unavailable`。旧 `outcomeUnknown` 仍表示最终效果未知，不能据此重放。

## 通用状态变化恢复

0.7.0 起，pi native 与 Claude MCP 对明确的 `state_changed` 采用相同流程，不依赖应用名称、联系人或输入框类型：

1. 使旧 stateId 失效，保留原任务及剩余预算，`cua_status.recovery` 记录 app、failedMethod 和 previousActionOutcome。
2. 此时仅允许对原应用 `cua_get_app_state`，不允许动作、应用启动或跨应用发现。再次遇到 state_changed 仍保留最初失败操作，不重置预算。
3. 成功取得新状态后解除只读限制，但新状态不能证明原操作成功或失败。Agent 须核对实际界面后选择下一步，无法确认则询问用户，不自动重放操作。

官方拒绝/取消、请求取消、预算到期和其他底层错误仍停止，不通过恢复规避。恢复只是重新观察，不保证任意 UI 操作能自动判定完成；未加入产品专属判断逻辑。

## 少一次重复读取

首次调用 `cua_get_app_state`。动作返回只有同时满足以下条件，才会签发**新** stateId：

- RPC 无错误、无拒绝/取消审批、无已知状态变化错误；
- 原生 `App=` 头的 bundle ID/PID 与前一状态相同；
- 完整 Window 头、0 standard window 根、唯一有效元素索引；
- 返回有截图，文字未截断、不是识别到的差分/局部状态。

随后 Agent 必须阅读动作返回的状态；如状态已足够，可直接使用新 stateId，无需额外 `get_app_state`。任何条件不满足就保守回退到显式观察，不在后台自动重读。

这只是完整结构与身份校验，不保证 UI 原子性或永不变化。旧 stateId 仍单次消费、有效期 60 秒、绑定 app/turn。菜单、局部状态和未识别格式保持原来的显式观察路径，不能靠猜测复用。

## 计时含义

`bridge.timings`：
- `initializeMs`：启动子进程到 initialize 返回的等待。
- `discoveryMs`：tools/list 往返。
- `rpcMs`：目标工具 RPC 往返，含官方内部执行/截图/取状态。
- `approvalMs`：等待官方授权的时间；它是上述阶段的子集，**不要重复相加**。
- `bridgeTotalMs`：本次桥接调用总耗时。

工具诊断还包含 `formatMs`、`toolElapsedMs`、`betweenCallsMs`。调用间隔包含主模型规划、其他工具和用户等待，**不是纯模型延迟**。冷启动与热调用应分开看；不能从单次任务总耗时判断 Sky 点击速度。

诊断不保存 UI 正文、截图、输入文本、任意服务报错正文或 API key；仍适用 pi 原有会话记录。不会额外生成完整轨迹文件。

## Native 计数与 Jev 硬预算

- 0.7.1 起，pi native 和 Claude native MCP 不设任务总时长或动作次数上限；无限制模式不创建任务截止计时器，不因超过 180 秒/30 次动作停止。
- native 的 durationMs/maxActions/remainingMs/remainingActions 均为 null，明确表示无上限；elapsedMs/actions 仍累计。单次调用超时、用户取消、stateId 的 60 秒有效期和授权要求不变。
- Jev 保留本轮 **180 秒 / 30 次动作尝试**预算。调用间隔、用户审批等待、初始化与网络等待均计入；到期取消在途请求。取消不代表已执行动作被撤销。
- pi 模式切换只改变是否执行上限检查，不清零当前轮的时间和动作计数；从长时间 native 任务切到 Jev 时，其有限预算可能已经耗尽，不可自动切模式绕过。
- Jev 动作数耗尽但时间尚存时仍可读最终状态。状态查询不启动计时；切应用、重连不重置计数。新用户任务才是新边界，不主动续期规避 Jev 限额。
- 单次调用超时或取消后仍停止，不自动重放；无限制 native 不等于无限重试或无限授权。固定基准的墙钟/动作预算是实验约定，与 native 运行时默认上限分开。

历史固定基准录入仍会拒绝超过 180 秒/30 动作仍标为 success 的记录；超预算失败仍可保留原始耗时与动作数。总耗时记录应在最终验证后立即结束，避免把编写报告的时间混入执行延迟。

## 验证边界

离线测试覆盖进程协议、返回状态复用、预算取消与结果分类。模拟例中两个连续动作只需 `get_app_state → action → action` 三次桥接调用，而非五次。**这证明减少调用次数，不是实测速度提升百分比。**

当前加载的 npm 插件不会随源码更改更新；要做新版本的真实 TextEdit/Chrome 验收，需先明确安装此 checkout、reload 并核对来源。未经该步骤不能用当前桌面工具结果冒充新代码验收。
