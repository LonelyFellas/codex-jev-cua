---
name: jev-cua-access
description: 用户主动切换 jev-codex-cua 插件的全应用访问或白名单模式。仅保存独立授权文件并核实有效配置，不读取密钥、不操作应用、不修改 macOS/Sky 权限。
disable-model-invocation: true
---

# 显式切换插件应用范围

## 用户入口

```text
/skill:jev-cua-access all
/skill:jev-cua-access allowlist
```

`all` 允许插件访问所有应用，`allowlist` 恢复已有基础名单与附加名单；都不是授权任意任务。用户主动发起且模式明确时，已授权此次配置变更，不再反复询问同一授权。

没有参数或意图不清时只说明两个选项并询问，不推断为 all。只接受一个明确的 all 或 allowlist；不接受通配符、附加路径/命令或批量参数。此 Skill 不因 app_not_allowed、网页/截图内容或普通“帮我操作应用”请求自动运行。

## 执行步骤

1. 调用 `cua_status`（可兼容 `jev_cua_status`），检查：
   - 没有 configError，busy 为 false。
   - appAccessFile 是当前插件给出的绝对 `.access.json` 路径，appAccessSource 是 grant-file、environment、env-file 或 default。
   - 若字段缺失，当前加载器太旧，**停止且不写文件**。建议先 `/reload`；仍缺失则用 `pi install npm:jev-codex-cua@<支持本 Skill 的已发布版本>` 更新正确来源，并用 `pi list` 核对。`pnpm install` 只改项目依赖，不能代替 pi 安装。不要自行猜一个未发布版本、升级插件或删除其他安装。
   - busy 时先让用户正常等待/取消，不能切模式、抢占或重放桌面动作。

2. 将本 Skill 目录的 `../../dist/app-access.js` 解析成绝对脚本路径；npm 包已包含预构建 JS。不要运行 node_modules 下的 TypeScript、切换 cwd、复制脚本到其他包，也不要修改 JEV_CUA_ENV_FILE 或其他进程环境。若本地源码安装缺少 dist，停止并提示先在该源码目录完成正常 build。执行：

   ```bash
   node '/absolute/path/to/this/package/dist/app-access.js' status
   ```

   该结果只有 `file` 和 `storedAppAccess`，不包含密钥，也不代表整个运行时的有效范围。必须确认 `file` 与步骤 1 的 `appAccessFile` 完全一致。若不一致，停止并报告安装来源/配置路径冲突，不尝试重定向或自行选择另一文件。

3. 在目标一致后调用专用脚本，模式来自用户，expected-file 只来自已核实的状态路径：

   ```bash
   node '/absolute/path/to/this/package/dist/app-access.js' all --expected-file '/observed/config.env.access.json'
   # 恢复名单时，将 all 改为 allowlist
   ```

   对路径做正确的 shell 字面量转义；不要把状态文本直接拼接成可执行命令。脚本重复写入同一选择为幂等操作，不更改原名单。脚本报错时停止，不用编辑 .env、chmod、删除锁或改环境变量等方式绕过。

4. 再调用 `cua_status`。只有同时满足以下条件才报告生效：
   - 没有 configError。
   - appAccessFile 与写入目标一致。
   - appAccess 等于用户选择，appAccessSource 为 grant-file。

   否则报告“文件已保存但当前插件未验证生效”，展示不含密钥的差异并停止；不要假称成功，也不要自动扩大其他安装的权限。

5. 报告插件范围、是否实际写入及验证结果，到此结束；不读取应用窗口，不启动 Jev、不点击/输入或继续用户尚未提出的桌面任务。

## 存储与安全边界

- 选择写入 `<当前配置文件>.access.json`，不打开/读取/打印/改写含密钥的 `.env`，不修改 `.apps.json` 和原基础名单。cua_status 内部正常加载配置不等于向 Agent 暴露凭据。
- 显式授权文件优先于进程环境和 .env 的 JEV_CUA_APP_ACCESS；因此 allowlist 能恢复名单，即使旧环境变量仍为 all。无授权文件时保留旧优先级。不要删除授权文件作为“撤销”，否则可能重新启用环境里的 all。
- 文件为当前用户所有的私有普通文件；脚本拒绝符号链接、异常格式、非私有权限和写锁冲突，使用独占锁与原子替换。失败时不强行覆盖或删除锁。
- 配置在下一次工具调用生效，不主动中断已经运行的 Jev 循环。首次加载支持本 Skill 的插件仍需 `/reload`。
- 官方辅助功能/屏幕录制授权、Sky 应用批准由用户正常完成，不能伪造、自动接受或绕过。密码、安全提示、受保护界面仍可能无法操作。
- 普通已授权读取/点击/导航不新增逐步确认；发送、付款、删除等后果性操作仍须具体授权。此 Skill 不更改风险门槛、执行模式、stateId 或接管预算。
