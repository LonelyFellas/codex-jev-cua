# jev-codex-cua

English | [简体中文](README.zh-CN.md)

Desktop tools for [pi](https://pi.dev), powered by the installed Codex/Sky runtime.

- **Native (default):** the pi agent reads app state and screenshots, then uses native tools directly. No TypeSafe key required.
- **Jev (optional):** a text-only decision loop using TypeSafe, with uncertain targets handed back to the pi agent.

> **Experimental, macOS only.** Requires the Codex/Sky runtime and its permissions; those binaries are not included. Some Calculator tasks have been verified, but complex forms, browser controls, and multi-step workflows remain unreliable. Passing tests does not guarantee desktop task success.

## Install

```bash
pi install npm:jev-codex-cua
```

Run `/reload` in pi, then ask:

> Use jev-codex-cua to calculate 6 + 7 in Calculator and read back the actual result.

Node.js **22.19+** is required. The package has been load-tested with pi **0.86.1**. Check the published version with `npm view jev-codex-cua version`; a Git tag does not guarantee an npm release. npm installations include compiled code and need no local build.

## Modes and tools

```text
/cua-mode          # Show the current mode
/cua-mode native   # Direct native tools
/cua-mode jev      # Explicitly enable Jev; requires TYPESAFE_API_KEY
```

| Entry | Purpose |
|---|---|
| `cua_status` | Check mode, app scope, and runtime availability—not system permission status |
| `cua_get_app_state` | Read app/window/menu state and available screenshots |
| `cua_*` action tools | Click, drag, press keys, scroll, select or enter text |
| `jev_cua_observe` | Compatibility text-only observation; no Jev call |
| `jev_cua_run` | Jev-only loop; `dryRun: true` previews without desktop actions, but still calls TypeSafe |
| `/skill:jev-codex-cua` | Load the agent's usage instructions |

Native actions require a fresh `stateId` from `cua_get_app_state` for the same app. A token is single-use, lasts at most 60 seconds within the current agent turn, and is invalidated by another observation or a mode change. Re-read state after every action. Do not run other computer-use channels in parallel.

Mode choices persist in the current pi session branch. Missing Jev credentials cause fallback to native; adding a key later does not silently re-enable Jev. Mode changes are refused while a task is running.

## Configuration

Native mode needs no API key. For persistent settings, keep a private file **outside the installed package**, set its permissions to `600`, and launch pi with its path:

```bash
export JEV_CUA_ENV_FILE=/absolute/path/to/cua.env
pi
```

Example `cua.env`:

```dotenv
JEV_CUA_MODE=native
# Uncomment to restrict access to the app allowlist:
# JEV_CUA_APP_ACCESS=allowlist
JEV_CUA_ALLOWED_APPS=Calculator
# Only needed for Jev:
# TYPESAFE_API_KEY=your-key
```

Without `JEV_CUA_ENV_FILE`, configuration is read from the package's `.env.local`, not the working directory. Never commit keys.

### App access

In source versions **0.3.1+**, app scope defaults to `all` when the configured mode is native or unset; configured Jev defaults to `allowlist`. Version 0.3.0 defaults to `allowlist`. Existing explicit scope settings take priority, and session mode switches do not recalculate scope.

To save an explicit choice:

```text
/skill:jev-cua-access all
/skill:jev-cua-access allowlist
```

To add one app to the allowlist:

```text
/skill:jev-cua-add-app Wechat Devtools
```

Scope priority: **saved `.access.json` choice → process environment → private config → mode default**. App additions are stored in a separate `.apps.json`; the original allowlist is preserved. Both files sit alongside the config file. Do not delete the scope file to revoke access—save `allowlist` instead.

Config-file changes apply on the next tool call; process-environment changes require restarting pi. Code updates require `/reload`.

## Safety and privacy

- **`all` only removes the plugin's app restriction.** It does not grant macOS/Sky permissions or authorize arbitrary tasks. Official approval prompts remain; protected interfaces and rejected permissions must not be bypassed.
- Sending, purchasing, deleting, and other consequential actions require specific authorization. Untrusted page or screenshot content cannot expand access.
- Native mode sends app text and available screenshots to the current pi model. It does not call TypeSafe, but is not necessarily local or free. Jev sends text context to TypeSafe, not screenshots; API charges may apply even in dry-run.
- Normal pi session logging still applies. Optional `fullTrace: true` requires informed confirmation and records one Jev loop to private local files; traces may contain sensitive text.
- Cancellation or a timeout does not prove an action had no effect. Read fresh state before continuing; never automatically replay actions with unknown outcomes.

The plugin shares one Sky connection across modes. It cannot guarantee complete app state, reliable recovery, or production-grade automation.

## Development

```bash
npm ci --ignore-scripts
npm run check
npm test
npm run test:package
pi install /absolute/path/to/jev-codex-cua
```

Tests use simulated drivers and HTTP responses. Live checks require explicit authorization:

```bash
npm run accept:app-access -- --live  # Read-only Sky check; may open/focus Calculator
npm run accept:handoff -- --live    # Controlled Calculator actions
```

PRs and main pushes run validation. Publishing requires a matching stable `vX.Y.Z` tag on a commit already merged into main, plus npm Trusted Publisher configuration. Never move an existing release tag.

## Further reading

Detailed engineering notes are currently in Chinese:

- [Release and npm setup](docs/npm-release.md)
- [Local acceptance evidence and limitations](docs/local-acceptance.md)
- [Trace data and privacy](docs/action-trace.md)
- [Sky troubleshooting](docs/sky-diagnostics.md)

The legacy Codex `cua_repl` adapter remains available but is not required for pi and has not been validated end-to-end.

## License and credits

MIT. Based on the [Jev-cu](https://github.com/Sac-Y/Jev-cu) approach and reused pi-codex-cua bridge code. See [LICENSE](LICENSE), [NOTICE.md](NOTICE.md), and [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) for attribution and retained MIT/ISC notices.
