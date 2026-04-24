## 1. Parser Compatibility

- [x] 1.1 Update `src/openclaw-installer/openclaw-cli.ts` to accept a single `~/...` config path from `openclaw config file`
- [x] 1.2 Normalize accepted `~/...` config paths to explicit absolute paths before returning them to installer callers
- [x] 1.3 Preserve existing failure behavior for empty, multi-line, whitespace-padded, and unsupported relative-path output

## 2. Validation Coverage

- [x] 2.1 Add focused tests or validation coverage for accepting a `~/.openclaw/openclaw.json` config path
- [x] 2.2 Add focused tests or validation coverage for `HOME`-based expansion, fallback to the platform home-directory helper, and fail-closed behavior when no usable home directory can be resolved
- [x] 2.3 Add focused tests or validation coverage for continuing to reject empty output, extra newline content, whitespace-padded values, and unsupported relative config paths

## 3. Regression Check

- [x] 3.1 Run `scripts/validate_openclaw_installer_install.ts` after the parser change to cover the `install` and `check` command paths
- [x] 3.2 Run `scripts/validate_openclaw_installer_repair_uninstall.ts` after the parser change
- [x] 3.3 Verify `install`, `check`, `repair`, and `uninstall` no longer require the manual `OPENCLAW_CONFIG_PATH` workaround when OpenClaw returns `~/...`
