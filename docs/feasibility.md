# Feasibility report

Decision: **GO**, with exactly six behaviorally distinct residual failures out of
the ten scenarios.

The gate has no safety margin. This result depends on precise scenario
definitions and causal matching. An unrelated incumbent warning for the same
package does not explain an observed runtime or type-check failure.

## Environment

The spike was run on 26 July 2026 with:

| Component | Version |
| --- | --- |
| Node.js | 24.16.0 |
| npm | 11.13.0 |
| publint | 0.3.22 |
| `@arethetypeswrong/cli` | 0.18.5 |
| `@arethetypeswrong/core` | 0.18.5 |
| ATTW bundled TypeScript | 5.6.1-rc |
| Current consumer TypeScript | 7.0.2 |

Scenario 9 was also executed with Node 18.20.8 to prove the claimed engine-floor
failure. Node 18 is used only as a fixture runtime and is not supported by
package-contract itself.

## Results

| # | Scenario | Consumer evidence | Incumbent result | Class |
| --- | --- | --- | --- | --- |
| 1 | Lazy dynamic import omitted from tarball | Calling the exported loader fails with `ERR_MODULE_NOT_FOUND` | No matching finding | Residual |
| 2 | `types` follows `import` in `exports` | Type resolution follows the earlier condition | publint reports the condition-order error | Explained |
| 3 | ESM with top-level await required by CJS | `require()` fails with `ERR_REQUIRE_ASYNC_MODULE` | ATTW reports `CJSResolvesToESM` for the same entrypoint | Explained |
| 4 | Runtime import declared only for development | Clean import fails with `ERR_MODULE_NOT_FOUND` | No matching finding | Residual |
| 5 | Shipped JavaScript uses a blocked self-reference | Import fails with `ERR_PACKAGE_PATH_NOT_EXPORTED` | No matching finding for the JavaScript edge | Residual |
| 6 | Declaration imports an undeclared type package | Consumer compilation fails with `TS2307` | No matching external dependency finding | Residual |
| 7 | Declared bin has no shebang | Installed command is not a valid Node executable | publint reports `BIN_FILE_NOT_EXECUTABLE` | Explained |
| 8 | Top-level side effect reads an omitted asset | Import fails with `ENOENT` | No matching finding | Residual |
| 9 | Code uses an API newer than the declared engine floor | Node 18 fails to import `globSync` from `node:fs`; Node 24 passes | No matching finding | Residual |
| 10 | Export target is absent from the tarball | Import fails because the target is missing | publint reports the missing target and ATTW reports no resolution | Explained |

Residual set: 1, 4, 5, 6, 8, and 9.

## Reproduction method

Every fixture was packed first. Both incumbents and every consumer saw that
same tarball.

```sh
npm pack --ignore-scripts --json
publint run ./m0-example-1.0.0.tgz
attw --format json --no-color --no-summary ./m0-example-1.0.0.tgz
```

Runtime fixtures were installed into fresh consumers from an absolute tarball
path:

```sh
npm install /absolute/path/to/m0-example-1.0.0.tgz \
  --ignore-scripts --no-audit --no-fund
node ./probe.mjs
```

The type fixture was compiled from the clean consumer with TypeScript 7.0.2.
The runtime-version fixture ran the same installed probe with Node 18.20.8 and
Node 24.16.0.

`run.mjs` regenerates the ten source fixtures, packs them, and captures the
incumbent outputs. Its generated tarballs and raw outputs are intentionally not
committed because they contain temporary paths and verbose TypeScript traces.

## Corrections to the original scenarios

Scenario 5 must use a self-reference in shipped JavaScript. ATTW can find the
equivalent problem in TypeScript and declaration files. Native Node
self-references honor `exports`, so a fixture claiming local success also needs
a concrete source alias or test-runner mapping.

Scenario 7 combined two different ideas. The missing-shebang case is explained
by publint. A source bin with a valid shebang and mode `0644` is normalized to
an executable file by npm pack and install, so "loses its executable bit" is
not a viable npm fixture as originally stated.

ATTW reports `CJSResolvesToESM` for ESM-only packages even when the package does
not claim CommonJS support. That finding cannot suppress unrelated
package-contract diagnostics. Suppression must match the observed failure,
entrypoint, profile, and semantics.

## Product implications

- The strongest gap is clean installation, runtime evaluation, current consumer
  compilation, missing runtime assets, and runtime-version execution.
- Scenario-specific actions are required for lazy imports and bins. A generic
  namespace import cannot exercise them.
- Profiles need applicability rules. An intentionally ESM-only package is not
  broken merely because `require()` does not work.
- Incumbent TypeScript and consumer TypeScript are separate recorded identities.
- Six residuals satisfy the gate, but future fixture growth must establish a
  wider and more defensible margin before release.
