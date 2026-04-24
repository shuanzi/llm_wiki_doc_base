## Why

The installer currently assumes that `openclaw config file` returns a single explicit absolute path. In real OpenClaw environments, the CLI may return a home-relative path such as `~/.openclaw/openclaw.json`, which causes install, check, repair, and uninstall to fail before they can evaluate the actual workspace state.

## What Changes

- Accept `openclaw config file` output when it is a single `~/...` home-relative path.
- Normalize accepted home-relative config paths to explicit absolute paths before the installer uses them.
- Ensure installer command flows that depend on OpenClaw config discovery (`install`, `check`, `repair`, and `uninstall`) continue past config-path discovery when the CLI returns a single `~/...` path.
- Preserve fail-closed behavior for empty output, multi-line output, whitespace-padded values, and unsupported relative paths.
- Add validation coverage for the accepted `~/...` case and the still-rejected unsupported relative-path cases.

## Capabilities

### New Capabilities
- `openclaw-installer-config-path-resolution`: Define how the installer accepts and normalizes OpenClaw config file paths returned by the OpenClaw CLI.

### Modified Capabilities
None. Existing specs do not define OpenClaw config-path discovery behavior.

## Impact

- Affected code: `src/openclaw-installer/openclaw-cli.ts`
- Affected validation: installer parsing/unit coverage and installer command validation paths that depend on OpenClaw config discovery
- No new runtime dependencies
