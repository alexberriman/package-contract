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

Strict offline installation is available with `--offline`. A missing cached
dependency becomes `not-evaluated`; the tool never calls that state compatible.

## Exit codes

| Code | Meaning |
| ---: | --- |
| 0 | No visible residual error was found |
| 1 | At least one visible residual error was found |
| 2 | Invalid invocation or the check itself could not complete |
