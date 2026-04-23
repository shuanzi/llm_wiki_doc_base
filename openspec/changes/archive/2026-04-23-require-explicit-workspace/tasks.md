## 1. CLI Contract Updates

- [x] 1.1 Make `--workspace` required for `check` in installer argument parsing and update related TypeScript types
- [x] 1.2 Update installer usage text and user-facing error messages to describe explicit workspace targeting
- [x] 1.3 Update `README.md`, `docs/openclaw-installer-agent-guide.md`, and `src/openclaw-installer/workspace-docs.ts` so shipped guidance matches the explicit-workspace contract

## 2. Explicit Workspace Validation

- [x] 2.1 Introduce or refactor a shared helper that normalizes the explicit workspace path and fails when the path does not exist or is not a directory
- [x] 2.2 Switch `install`, `check`, `repair`, and `uninstall` to use the explicit workspace validation helper instead of default-agent workspace resolution
- [x] 2.3 Update `install` and `repair` flows to stop creating missing workspace directories and make plain `check` fail directly on invalid workspace paths

## 3. Default-Agent Decoupling

- [x] 3.1 Remove installer command enforcement that compares explicit `--workspace` against the current OpenClaw default-agent workspace
- [x] 3.2 Simplify `check` workspace handling so it diagnoses the explicit workspace only
- [x] 3.3 Remove default-agent-specific skill eligibility checks that no longer describe the targeted workspace

## 4. Validation Coverage

- [x] 4.1 Update install/check validation scripts for required `--workspace` semantics and missing-path failures
- [x] 4.2 Update install/check/repair/uninstall validation scripts to cover explicit non-default workspaces, ambiguous default-agent configurations, and invalid workspace paths
- [x] 4.3 Rebuild artifacts and run the targeted installer validation scripts to confirm the new contract end to end
