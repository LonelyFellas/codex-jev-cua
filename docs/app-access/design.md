# 应用访问设计

## 最小方案

- 新增独立配置 JEV_CUA_APP_ACCESS=allowlist|all，默认 allowlist。用户显式设置 all 才启用全应用范围，不把名单中的 * 解释为授权。
- 未保存独立授权选择时，配置沿用环境变量优先于私有环境文件的规则；未知值报错，不回退到 all。后续新增的 Skill 授权文件具有更高优先级，见 [应用范围 Skill 设计](../app-access-skill/design.md)。
- 原 allowedApps 和 .apps.json 保留，切回 allowlist 即恢复；不变更单应用追加脚本的语义。
- 统一应用范围检查，覆盖 observe/run 及 native 入口。应用身份发现 list_apps 保持原行为，不代表窗口读取授权。全应用模式仍要求具体应用名，不把 all 当 Sky app 参数。
- Jev 循环仅接受本次已通过范围检查的目标应用，避免将全局通配能力传入策略层；敏感动作策略不改。
- 状态输出 appAccess、allowedApps，以及 officialApproval=runtime-controlled、systemPermissions=not-checked；明确全应用只属于插件层。
- 更新 README 和相关 skill，说明用户启用/撤销方式，模型不得为完成任务自行扩权。

## 不做

不自动修改当前用户配置，不自动部署/重载已安装插件，不新增自动接受 elicitation 的缓存或开关，不发送 Sky 未声明的参数，不更换原生控制引擎，不宣称可以操作所有受保护界面。

独立控制程序的 macOS Accessibility/Screen Recording 首次授权属于另一条原生引擎路线；当前项目复用官方 Sky 进程链，不把 Node 插件伪装成权限拥有者。Apple Events 的目标应用授权也不能由本配置代替。

## 验证计划

- 配置：缺省、all、allowlist、非法值、环境覆盖、撤销后的原名单、私有文件权限。
- 工具：名单外应用默认拒绝；显式 all 后通过插件范围检查；具体目标传递给 Sky；普通任务零额外确认。
- 安全回归：all 下官方拒绝与无 UI 仍拒绝、敏感动作不执行、取消不重试，状态不泄露凭据。
- 双模式：验证 native 与 Jev 使用同一范围检查，保留 stateId、模式隔离和剩余预算门禁。
- 运行 npm run check、npm test、npm run test:package（含 build）；真实桌面测试另行依据具体用户任务执行。

配置以每次 pi 工具调用为边界重读；不主动打断已启动的 Jev 循环。工具参数不提供授权修改接口，模型不能通过 appAccess 参数提升应用范围。
