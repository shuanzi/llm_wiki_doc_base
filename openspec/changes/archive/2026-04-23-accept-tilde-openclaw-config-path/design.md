## Context

The installer shells out to `openclaw config file` to discover the active OpenClaw config path before it performs install, check, repair, or uninstall work. The current parser accepts only a single explicit absolute path, which is stricter than real OpenClaw CLI behavior because some environments return `~/.openclaw/openclaw.json`.

The change is intentionally narrow. The installer should become compatible with home-relative config paths without weakening its existing fail-closed behavior for malformed output. No existing OpenSpec capability in this repository defines config-file discovery semantics, so this behavior is specified as a new installer capability rather than a delta against an unrelated workspace-targeting spec.

## Goals / Non-Goals

**Goals:**
- Accept `openclaw config file` output when it is a single `~/...` path.
- Normalize accepted home-relative paths to explicit absolute paths before downstream use.
- Ensure all installer commands that rely on config discovery (`install`, `check`, `repair`, and `uninstall`) inherit the compatible parser behavior.
- Preserve existing rejection of empty, multi-line, whitespace-padded, and unsupported relative path output.
- Add validation coverage for accepted and rejected path forms.

**Non-Goals:**
- Supporting arbitrary relative paths such as `tmp/openclaw.json`.
- Supporting user-qualified home syntax such as `~otheruser/...`.
- Changing the installer command flow, ownership rules, or MCP probing behavior.
- Changing OpenClaw CLI output itself.

## Decisions

### Decision: Normalize `~/...` inside the installer parser
The parser that currently validates `openclaw config file` output will be extended to accept either:
- an already explicit absolute path, or
- a single `~/...` path, which the installer expands to an absolute path.

Rationale:
- This is the smallest possible compatibility fix.
- The rest of the installer already expects a resolved absolute path, so normalization should happen at the boundary where CLI output is parsed.
- It avoids adding special cases throughout the installer workflow.

Alternatives considered:
- Require operators to set `OPENCLAW_CONFIG_PATH` manually.
  Rejected because it is an operational workaround, not a product fix.
- Relax validation to accept any relative path.
  Rejected because it weakens fail-closed behavior and makes path resolution ambiguous.

### Decision: Expand `~/...` using local environment home resolution
Home-relative paths will be expanded using the current process home directory, preferring `process.env.HOME` and falling back to the platform home-directory helper if needed. If neither source yields a usable home directory, the parser will fail closed instead of guessing.

Rationale:
- The installer and the spawned OpenClaw CLI run in the same operator environment.
- This preserves expected shell semantics without introducing custom path lookup logic.

Alternatives considered:
- Resolve `~` by invoking a shell.
  Rejected because it adds unnecessary process complexity and quoting risk.
- Reject `~/...` and document the limitation.
  Rejected because it leaves the installer incompatible with real CLI output already observed in the field.

### Decision: Keep strict single-line parsing rules unchanged after stdout framing normalization
The parser will continue to strip exactly one trailing command-output line ending (`\n` or `\r\n`) before validating the path candidate, because that line ending is transport framing rather than part of the path value.

The installer will continue to reject:
- empty output
- output with any additional newline after trailing-line-ending normalization
- values with surrounding spaces or tabs
- unsupported relative paths that do not start with `~/`

Rationale:
- The compatibility fix should not silently broaden the accepted surface beyond the known valid case.
- These checks protect the installer from parsing decorative output, warnings, or ambiguous paths as valid configuration state.

### Decision: Treat this as a shared installer boundary, not a single-command fix
The parser change will be validated through the installer command paths that consume OpenClaw config discovery, specifically `install`, `check`, `repair`, and `uninstall`, so the fix cannot regress in one command while appearing complete in another.

Rationale:
- The field failure affects command execution rather than only a helper function.
- Command-level validation is the clearest proof that the `OPENCLAW_CONFIG_PATH` workaround is no longer required for accepted `~/...` output.

## Risks / Trade-offs

- [Risk] `HOME` may differ from the environment OpenClaw used to choose the config file. → Mitigation: use the installer process environment first, which is the same environment used to spawn OpenClaw in normal operation.
- [Risk] Home-directory resolution may be unavailable in some environments. → Mitigation: fail parsing explicitly rather than guessing a replacement path.
- [Risk] Accepting `~/...` could mask malformed outputs that happen to begin with `~`. → Mitigation: only accept the exact `~/` prefix and continue rejecting all other relative forms.
- [Trade-off] The installer remains strict about `~otheruser/...` and generic relative paths. → Mitigation: keep the scope limited to the observed compatibility issue; expand later only if a real requirement appears.
