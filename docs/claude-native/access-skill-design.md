# Claude 权限 Skill 需求与设计

## 需求
- 按用户要求，新版 Claude MCP 全新安装默认 all；已有 grant/environment/env-file 的显式 allowlist 不被覆盖。与已发布 0.4.0 的旧默认明确区分。
- 用户显式调用 `/deskhand-access add <单个应用>` 或 `/deskhand-access all|allowlist`。
- 只写当前 Claude MCP 配置旁的专用授权文件；不读取/改写含密钥的环境文件、不误改 pi 配置、不操作桌面或修改系统权限。
- 必须先读 MCP status 核对 host/native、无活动任务、CLI 能力及路径；保存后重新读 status 验证生效，不能将落盘等同生效。
- Skill 仅用户可触发，不因桌面任务失败自动扩权。Skill 与 MCP 安装分离，提供显式安装命令，不用 postinstall 自动改用户目录。

## 实施
- `claude-skills/deskhand-access/SKILL.md` 不放 pi 的 skills 目录，避免混淆；独立 installer 复制到 CLAUDE_CONFIG_DIR/skills 或 ~/.claude/skills，已存在不同内容/符号链接拒绝覆盖，同内容幂等。
- MCP status 增加 accessManagement（version、cliPath、appsFile），沿用 envFile/appAccessFile。Skill 可从自定义名称的 deskhand MCP 发现 status，不硬编码 mcp__deskhand 名称。
- `dist/mcp/access.js` 使用 status 提供的绝对 `--config` 和 `--expected-file`，精确校验派生路径后复用既有 addAppGrant/setAppAccessGrant。终端环境不能决定目标，因此支持 MCP 自定义 DESKHAND_CONFIG_FILE 不在终端环境的情况。
- status 子命令只读两份 grant JSON，不打开 env；写入前校验参数、既有授权文件，创建缺失父目录为700，授权为600。拒绝异常文件、符号链接、锁冲突，不绕过或强行修复。
- 保留原名单；all/allowlist 不清空追加授权；add 不切换范围。在 all 模式新增应用只为将来恢复名单保留，不误报范围变化。
- 状态字段缺失（0.4.0）时提示升级/重连，不猜路径。用户明确指定与 pi 共用配置时可能共享授权，写前说明并确认共享意图。

## 验证
离线测试覆盖默认/自定义路径、CLI 参数不匹配不写入、不读取环境文件、追加/去重、范围切换、权限文件安全、安装幂等/拒绝覆盖与 MCP 即时生效。打包测试确认 Skill、CLI、installer 分发且 pi 的三个 Skill 不变。不自动安装到真实 Claude 用户目录，不自动提交或发布。
