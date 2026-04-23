## Purpose

Define how the OpenClaw installer resolves and validates the OpenClaw config file path reported by the OpenClaw CLI.

## Requirements

### Requirement: Installer accepts single home-relative OpenClaw config paths
The installer SHALL accept `openclaw config file` output when it contains exactly one non-empty path value and that value is either an explicit absolute path or a home-relative path that begins with `~/`.

#### Scenario: Explicit absolute config path is accepted
- **WHEN** `openclaw config file` returns a single explicit absolute path
- **THEN** the installer accepts the value as the OpenClaw config path

#### Scenario: Home-relative config path is accepted
- **WHEN** `openclaw config file` returns a single path that begins with `~/`
- **THEN** the installer accepts the value as a valid OpenClaw config path input

### Requirement: Installer commands continue when config discovery returns an accepted home-relative path
The installer SHALL use the normalized config path for every command path that reads the OpenClaw config file, including `install`, `check`, `repair`, and `uninstall`, and SHALL NOT fail config discovery solely because the CLI returned a single `~/...` path.

#### Scenario: Install continues after accepted home-relative config discovery
- **WHEN** `install` reads `openclaw config file` output that is a single path beginning with `~/`
- **THEN** the installer normalizes the config path
- **AND** the command continues normal install evaluation instead of failing config-path parsing

#### Scenario: Check continues after accepted home-relative config discovery
- **WHEN** `check` reads `openclaw config file` output that is a single path beginning with `~/`
- **THEN** the installer normalizes the config path
- **AND** the command continues normal check evaluation instead of failing config-path parsing

#### Scenario: Repair continues after accepted home-relative config discovery
- **WHEN** `repair` reads `openclaw config file` output that is a single path beginning with `~/`
- **THEN** the installer normalizes the config path
- **AND** the command continues normal repair evaluation instead of failing config-path parsing

#### Scenario: Uninstall continues after accepted home-relative config discovery
- **WHEN** `uninstall` reads `openclaw config file` output that is a single path beginning with `~/`
- **THEN** the installer normalizes the config path
- **AND** the command continues normal uninstall evaluation instead of failing config-path parsing

### Requirement: Installer normalizes accepted home-relative config paths before use
The installer SHALL normalize accepted `~/...` OpenClaw config paths into explicit absolute paths before later installer logic uses the config path. The installer SHALL resolve `~/...` using the current process home directory, preferring `process.env.HOME` and falling back to the platform home-directory helper if needed.

#### Scenario: Home-relative config path is normalized with process HOME
- **WHEN** `openclaw config file` returns `~/.openclaw/openclaw.json`
- **AND** `process.env.HOME` is set to the operator home directory
- **THEN** the installer resolves the path to the operator home directory as an explicit absolute path
- **AND** later installer logic receives the normalized absolute path rather than the original `~/...` string

#### Scenario: Home-relative config path falls back to platform home-directory resolution
- **WHEN** `openclaw config file` returns a single path beginning with `~/`
- **AND** `process.env.HOME` is unavailable
- **THEN** the installer resolves the path using the platform home-directory helper

#### Scenario: Missing home-directory resolution fails closed
- **WHEN** `openclaw config file` returns a single path beginning with `~/`
- **AND** the installer cannot determine a usable operator home directory
- **THEN** the installer fails config-path parsing instead of guessing a replacement path

### Requirement: Installer rejects unsupported config path output forms
The installer SHALL continue to reject `openclaw config file` output that is empty, contains additional newline content after stripping exactly one terminal command-output line ending, includes surrounding spaces or tabs, or uses unsupported relative path syntax.

#### Scenario: Single terminal line ending is tolerated
- **WHEN** `openclaw config file` returns a single valid path followed only by one terminal line ending
- **THEN** the installer parses the path value normally

#### Scenario: Additional newline content is rejected
- **WHEN** `openclaw config file` returns a valid path followed by any additional newline content, including a blank extra line
- **THEN** the installer fails config-path parsing

#### Scenario: Unsupported relative path is rejected
- **WHEN** `openclaw config file` returns a single relative path that does not begin with `~/`
- **THEN** the installer fails config-path parsing

#### Scenario: Whitespace-padded output is rejected
- **WHEN** `openclaw config file` returns a single path value with leading or trailing spaces or tabs
- **THEN** the installer fails config-path parsing

#### Scenario: Empty output is rejected
- **WHEN** `openclaw config file` returns an empty path value
- **THEN** the installer fails config-path parsing
