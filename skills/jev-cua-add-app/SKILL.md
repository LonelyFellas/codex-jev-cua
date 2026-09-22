---
name: jev-cua-add-app
description: 仅在用户明确要求时，为 jev-codex-cua 追加一个指定应用到插件白名单。不删除或替换已有授权，不读取密钥，不修改 macOS/Codex 权限，不启动或操作应用。
---

# 只追加一个应用授权

## 授权边界

- 必须有用户明确的“添加/允许某个应用”请求，或用户直接调用本 skill 并给出应用名。普通桌面任务报 app_not_allowed 时，不得自行调用本 skill 扩大权限。
- 每次只添加一个明确应用。没有名称先询问；多个名称或通配符请求不执行。全部应用请求不交给本脚本，提示用户主动调用 `/skill:jev-cua-access all`；本 skill 不读取或修改全应用访问配置，也不自动代替用户调用该命令。
- 这里只管理 **jev-codex-cua 插件白名单**，不是系统或官方 Computer Use 授权。不能伪造官方批准、修改权限数据库或关闭安全检查。
- 不允许删除、重置、替换名单，不允许改密钥、其他配置、权限门槛或执行模式。
- 不读取、打印、编辑 `.env.local`。使用专用脚本，它只打开单独的 `.env.local.apps.json`（若配置 JEV_CUA_ENV_FILE，则使用该路径加 `.apps.json`）。不要自行修改 JEV_CUA_ENV_FILE 重定向配置。

## 步骤

1. 调用 `jev_cua_status`。如果应用已经在 allowedApps 中，直接报告插件名单已允许，不写文件。如果 appAccess=all，说明当前已通过插件范围检查（不代表系统或 Sky 授权），通常无需追加；只有用户还明确要求将该应用保留到 allowlist 时才继续追加。
2. 确认精确名称。必要时用 `list_apps` **仅查找名称**，不能通过 get_app_state/observe 读取未授权应用。多个匹配时让用户选择，不猜。如果使用 .app 路径，后续工具也必须用完全相同的路径作为 appName。
3. 执行本 skill 目录下相对路径 `../../src/add-app.ts`，把应用名作为唯一参数。先将脚本路径解析为绝对路径；应用名须正确 shell 引号转义，不拼接额外命令。

例如名称确认为 `Wechat Devtools` 后执行：

```bash
node --experimental-strip-types /absolute/path/to/package/src/add-app.ts 'Wechat Devtools'
```

也可在包目录执行：

```bash
npm run allow-app -- 'Wechat Devtools'
```

4. 再调用 `jev_cua_status` 核实 allowedApps 包含该应用。首次安装新增 skill/配置读取代码需要 pi `/reload`；之后新增授权文件每次调用都会重新读取，无需再次 reload。
5. 报告追加结果，到此结束。本 skill 不打开应用、不调用 Jev、不做点击/输入，不代替用户的后续任务指令。

## 脚本保证与失败处理

- 单条追加、去重；已有条目保留；不接受 `--remove`/`--replace`、批量名单或通配符。
- 授权文件为当前用户所有、0600；拒绝符号链接、异常格式或不安全权限。创建锁，写入独立临时文件并原子替换，避免协作更新丢失。
- 不读取凭证文件、不联网、不启动应用，也不修改官方授权状态。
- 锁冲突或异常文件时停止，不强行覆盖、删除锁或扩大访问范围；向用户报告原因。
- 授权是本地追加配置，已被 Git 忽略。只能追加这一功能并不意味着模型获得任意新增应用的自主授权。
