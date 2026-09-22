# npm 版本与自动发布

包名：`jev-codex-cua`，当前源码版本见 `package.json`（实验原型）。Registry 是否已发布以 `npm view jev-codex-cua versions` 为准，不以本地版本或 tag 存在作为发布成功证据。

## Tag 触发

`.github/workflows/publish.yml`：

- PR 和 `main` 推送运行类型检查、离线测试和真实打包/隔离安装验证，不发布。
- 推送 `v*` tag 才可能发布；发布检查只接受稳定版 `vX.Y.Z`，tag 必须与 package.json、package-lock.json 的版本一致。
- tag 对应提交必须已经包含在 `origin/main`，不能从未合并的功能分支发行。
- 只有官方仓库 `LonelyFellas/codex-jev-cua` 的 tag push 能进入发布 job。
- 发布 job 在 GitHub 托管的 Ubuntu runner 运行，Node 24，使用 npm Trusted Publishing / OIDC 和 provenance，不配置长期 npm token。
- 验证 job 只有 contents:read；发布 job 额外获得 id-token:write。不启用真实桌面或 TypeSafe 测试。
- `npm publish` 正常执行 prepublishOnly 门禁，不跳过脚本。发布后查询 registry 验证版本；查询可重试，发布本身不自动重试。

## 首次绑定 Trusted Publisher

维护者在 npm 包设置的 Trusted Publisher 中配置：

| 字段 | 值 |
|---|---|
| Provider | GitHub Actions |
| Organization or user | `LonelyFellas` |
| Repository | `codex-jev-cua` |
| Workflow filename | `publish.yml`（不是完整路径） |
| Environment | 留空（此 workflow 未绑定 environment） |
| Allowed actions | 允许直接 `npm publish`，而非仅 staged publishing |

npm CLI >=11.15.0 也可通过官方命令管理，仍须账号持有人完成二次验证：

```bash
npm trust list jev-codex-cua
npm trust github jev-codex-cua \
  --repo LonelyFellas/codex-jev-cua \
  --file publish.yml --allow-publish
```

先检查已有绑定；若存在不匹配的绑定，不自动撤销/替换，先确认维护者意图。不要将 token/OTP 粘贴到聊天、仓库或日志。初次绑定不等于已通过发布验证；必须确认 Actions 结果和 registry。参考 [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) 与 [npm trust](https://docs.npmjs.com/cli/v11/commands/npm-trust/)。

## 每次发版

1. 新任务从最新 `origin/main` 创建独立分支/worktree。
2. 更新代码、文档及 package.json/package-lock.json 版本；执行本地门禁，提交 PR 并合入 main。
3. Fetch 后在已合并提交上打 tag 并推送（以下 `0.2.0` 仅示范本次目标版本，后续使用新版本）：

```bash
git fetch origin
git tag -a v0.2.0 origin/main -m 'Release jev-codex-cua 0.2.0'
git push origin v0.2.0
```

4. 查看 Actions 的 `Validate and publish npm` 运行，确认 publish job 成功，再查询：

```bash
npm view jev-codex-cua@0.2.0 version dist.integrity dist.attestations --json
```

不覆写已发布的 npm 版本，不强推/移动版本 tag。若发布失败，先确认失败发生在发布前还是发布后；若 registry 已存在该版本，不再次 publish。发布前的暂时故障可以在修复外部配置后重跑原 workflow；代码变更应提交并使用新版本/tag。

## 本地门禁与实机验证

```bash
npm ci --ignore-scripts
npm run check
npm test
npm run test:package
```

`test:package` 触发 npm pack/prepack，安装 tarball 到临时目录，通过 pi 加载器验证 14 个工具、模式命令和 2 个 Skill，以及编译后 API。消费者采用 omit=dev、ignore-scripts、offline；legacy-peer-deps 仅模拟宿主提供 peer，不是绕过发布门禁。

可选实机测试必须显式授权并传 `--live`，不在 CI 中运行。`accept:app-access` 为真实 Sky 只读范围验收；`accept:handoff` 会操作 Calculator 且包含模拟决策。边界见 [本地验收](local-acceptance.md)。

## 包结构与许可

遵循 [pi 包规范](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)：`keywords` 包含 pi-package，pi.extensions 指向 src/pi-extension.ts，pi.skills 指向 skills/。默认 native，只有显式 jev 模式调用 TypeSafe；一个包共用 Sky 桥接。

宿主 pi/typebox 使用 peerDependencies，开发依赖独立锁定；不打包宿主副本。白名单包含源码、预构建 dist、Skills、fixtures、文档及许可；不包含密钥、应用授权、轨迹、测试、node_modules。prepack 构建 dist，消费者无需自行编译。

新增代码采用 MIT；第三方 ISC/MIT 声明及原桥接版权保留在 NOTICE.md、THIRD_PARTY_LICENSES.md 和原授权文件中。发布不改变许可证或原作者归属。

## 安装与升级

版本在 registry 确认后：

```bash
pi install npm:jev-codex-cua
# 固定版本（示例）：
pi install npm:jev-codex-cua@0.2.0
```

安装后 `/reload`。固定版本升级需重新指定新版本；非固定版本可用 `pi update npm:jev-codex-cua`。合并/发布不会自动更新用户当前安装或权限配置。

密钥和应用范围配置应放在包外，通过 `JEV_CUA_ENV_FILE` 指定绝对路径，文件权限 600；相邻 `.apps.json` 也留在包外。`JEV_CUA_APP_ACCESS=all` 只放宽插件范围，不能代替系统/Sky 授权。确认新安装成功后再移除旧来源以免同名工具重复注册，不自动移动凭证或删除原包。
