# Command-line interface

## Check

```sh
package-contract check [directory-or-tarball]
```

The default human reporter prints nothing for a healthy package. `--json`
produces deterministic machine-readable output. `--reporter github` emits
workflow commands for residual diagnostics. `--include-explained` includes
failures already explained by Publint or Are the Types Wrong, without changing
the meaning of residual findings.

Strict offline installation is available with `--offline`. Each check uses an
isolated cache, so a package with registry dependencies normally produces an
offline cache miss unless the library API supplies a populated `npmCachePath`.
A cache miss becomes `not-evaluated` and exits with code 2.

## Reproductions

Run a check once to obtain a diagnostic ID, then materialize that exact failure:

```sh
package-contract check . --repro <diagnostic-id>
```

The output directory is `repros/<diagnostic-id>`. It contains only an immutable
copy of the tarball, a minimal consumer manifest and probe, an optional
TypeScript configuration, and a short README. Existing directories are never
overwritten. Lifecycle scripts remain disabled in the provided install command.

## Compare

```sh
package-contract compare <before> <after>
```

Both artifacts run through the same profiles. The before artifact populates an
isolated npm cache, and the after artifact installs offline from that captured
state. Diagnostics are classified as regressions, fixes, or unchanged by their
stable identity. The comparison is marked inconclusive when the normalized
lockfiles show a different dependency graph, when the captured cache cannot
satisfy the after artifact, or when either installation produced no lockfile.
Inconclusive comparisons exit with code 2.

## Exit codes

| Code | Meaning |
| ---: | --- |
| 0 | No visible residual error or unexpected incomplete evaluation was found |
| 1 | At least one visible residual error was found |
| 2 | Invalid invocation or the check itself could not complete |
