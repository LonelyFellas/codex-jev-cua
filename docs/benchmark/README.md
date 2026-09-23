# 固定真实桌面任务集（desktop-v1）

这是一套**人工执行、证据复核、离线统计**的基准，不是自动桌面测试器。运行 CLI 不会操作桌面，不会调用 Jev，也不证明结果真实性。首次建议每任务 3 次（每模式 18 次），稳定后提高到 10 次。所有任务定义以 `scripts/benchmark-core.ts` 的版本化 TASKS 为准；改变任务/验收条件必须升级 suite 版本。

## 固定任务

| ID | 任务 | 最终验收 |
|---|---|---|
| calculator-add | 12 + 30232 | 30244 |
| calculator-chain | (48 + 27) × 3 | 225 |
| textedit-type | 英文与中文两行输入 | 精确正文匹配 |
| textedit-replace | 局部替换 beta | alpha BETA gamma |
| browser-form | 本地表单选择、填写、预览 | Deskhand \| Team \| agreed |
| browser-delayed | 等待控件出现再填写验证 | Details verified |

Chrome 使用 `fixtures/benchmark/form.html` 的绝对 `file://` URL。页面无远端依赖、无网络请求、无真实提交。TextEdit 只使用新建测试文档，不保存到用户已有路径。准备与清理由操作者执行；清理仅关闭本次创建的测试页面/文档，不关闭或丢弃用户其他工作。

## 1. 固定环境与计划

在仓库外建立私有结果目录，例如 `mkdir -m 700 ~/deskhand-benchmark-results`。不要把 AX 原文、截图、会话内容提交到 Git 或打包发布。

创建该目录下的 `config.json`（权限 600）：

```json
{
  "mode": "native",
  "execution": "live",
  "commit": "填写被测插件的完整40位Git提交SHA",
  "mainModel": "填写实际主模型ID与thinking配置",
  "jevModel": "none",
  "macOS": "填写系统版本与语言",
  "appVersions": "Calculator=实际版本; TextEdit=实际版本; Chrome=实际版本",
  "runtime": "填写Codex/Sky实际版本或构建标识",
  "display": "填写显示器数量、分辨率、缩放、浏览器缩放",
  "repetitions": 3
}
```

必须填写真实环境，不直接使用示例占位符。commit 是**实际加载的插件版本**，不是任意当前目录的 HEAD；固定版本后 reload 并核对加载来源。未提交实现的测试需另行保留 diff 证据，不能冒充该 SHA 的结果。Jev 模式填写实际模型版本或服务别名（例如 `jev-latest`，同时在证据中保留测试日期；别名会漂移）。

```bash
npm run benchmark -- init ~/deskhand-benchmark-results/config.json ~/deskhand-benchmark-results/batch-000.json
```

生成所有任务与运行槽，默认全为 pending。每个模式、execution、模型、插件版本、环境各建独立批次，不能中途修改配置或挑任务删槽。native/Jev 对照时采用相同任务与重复数；建议按重复轮次交替模式，控制学习与环境顺序效应。

`execution`：
- `live`：真实应用、真实主模型/Jev 决策，无预设模拟回复。
- `controlled`：真实应用，但任何决策/接管选择由脚本预设或模拟。
- `simulated`：没有真实桌面执行。

汇总只接受一个批次，不跨类型混算。不要把受控接管验收标成 live。

## 2. 执行与记录

真实桌面操作前取得用户任务授权；Jev 必须显式选择且说明数据发送/费用。不要为测试自行扩大应用范围，官方授权拒绝后停止。本工具不会完成这些步骤。

每槽执行协议：

1. 按 setup 人工重置，确认无上次任务残留。新开被测 Agent 会话，避免上次答案/恢复记录影响本次运行；固定模型配置。
2. 执行前预定该槽的 180 秒墙钟预算、最多 30 次动作。Jev 单次调用可受插件更小预算限制，整个任务不得超过总预算。读操作不算动作；点击/输入/按键/滚动/拖拽及派发失败且结果未知的动作尝试都算。预算到达即正常取消；未知执行结果不重放。
3. 在交付完整 goal 前记录 ISO UTC 开始时间（`new Date().toISOString()`）。计时包含规划、网络、官方授权、等待与人工纠错；准备/清理不计入。不得暂停计时隐藏失败成本。
4. 记录所有人工接管、Jev→主模型接管与已派发错误动作；不要只记录最终成功的那段。
5. 重新观察并按 verify 核对结果，保存证据引用；成功、失败、超时、阻塞或取消后记录结束时间。超时记 failed/reason=timeout；取消记 cancelled；缺权限/环境或官方拒绝记 blocked。没有执行条件也应记录 blocked，不从计划中删除。
6. 保存结果。重新开始不能覆盖本槽；用下一个预定重复槽并完全重置，额外尝试另开批次。中断后恢复同一个未结束任务必须继续原开始时间；取消就是终态。

计数定义：
- `humanInterventions`：用户额外纠错、给出下一步或手动完成任务动作的次数；连续一次帮助计一次。初始任务、预定 setup、普通官方权限确认不算。用户响应缺失意图的追问算一次。
- `plannerHandoffs`：Jev 交回真实主模型重新规划的次数；不是人工接管。native 一般为 0。
- `wrongActions`：已派发且偏离 goal/预期步骤的动作，即使后续纠正仍计入。被门禁拦截的建议不计；未知结果先保留失败原因与证据，不猜测错误数。需要人工复核，不能依赖执行模型自报。
- `verification`：实测最终状态与验收条件的对照；不是“工具返回成功”。
- `evidence`：本地会话ID、轨迹/截图路径、时间段等可核查引用；失败也需证据。仅写引用，不把敏感正文嵌入批次文件。脱敏并由操作者复核。

单次 `result.json` 示例（**只展示格式，禁止作为实测数据录入**）：

```json
{
  "status": "success",
  "startedAt": "2026-01-01T00:00:00.000Z",
  "endedAt": "2026-01-01T00:00:20.000Z",
  "humanInterventions": 0,
  "plannerHandoffs": 0,
  "actions": 10,
  "wrongActions": 0,
  "evidence": ["替换为真实本地证据引用与时间段"],
  "verification": "替换为最终观察结果及与验收条件的对照",
  "reason": ""
}
```

```bash
npm run benchmark -- record ~/deskhand-benchmark-results/batch-000.json calculator-add/1 ~/deskhand-benchmark-results/result.json ~/deskhand-benchmark-results/batch-001.json
```

每次从**最新批次文件**继续生成下一版本，保留旧版本。record 拒绝已完成槽与已存在输出文件；这是防误覆盖，不是防篡改存证。手工更改 JSON 或从旧版本分叉仍可能制造矛盾，证据复核者必须核对版本链，不挑选最好结果。

## 3. 汇总与解释

```bash
npm run --silent benchmark -- report ~/deskhand-benchmark-results/batch-001.json
```

按总体和单任务分别输出：
- planned / recorded / pending / complete，以及 success / failed / blocked / cancelled 数量。
- `finalSuccessRate`：最终通过验收 / 所有已记录槽，包含纠错后成功。
- `autonomousSuccessRate`：无人工接管且无错误动作的成功 / 所有已记录槽。允许 Jev→主模型接管，必须同时看 plannerHandoffs。
- `successfulFractionOfPlan`：成功数 / 所有预定槽；避免 pending 被忽略后夸大进度。
- 全部已记录运行与成功运行分别统计耗时中位数/P95（nearest rank），单位毫秒。
- 人工接管、模型接管、动作与错误动作总数、错误动作比例、出现错误动作的运行数。

比例取值 0..1；无已记录样本时成功率为 null，不是 0 或 100%。未完成批次只能说“阶段性结果”；小样本 P95 不代表生产 SLA。blocked 拉低的是端到端可用率，不应直接归因于模型；请同时看状态分布和 reason。

本基准不覆盖多应用协作、真实网络、登录、支付、发布、高风险删除、多显示器泛化或长期无人值守。单元测试只验证记录与统计逻辑；发布 CI 不执行真实桌面任务。
