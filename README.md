<div align="center">

# package-contract

### Test the npm package your users actually install.

Pack it. Install it cleanly. Import every public entrypoint. Compile it with the
consumer's TypeScript. Catch the release that looked perfect from inside the
repository.

[![CI](https://github.com/alexberriman/package-contract/actions/workflows/ci.yml/badge.svg)](https://github.com/alexberriman/package-contract/actions/workflows/ci.yml)
[![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript 5.6–7](https://img.shields.io/badge/TypeScript-5.6%E2%80%937-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

</div>

---

Your source tests can all pass while the published package is unusable.
Workspace hoisting hides undeclared dependencies. Source imports bypass the
`exports` map. Files that exist beside the source never make it into the
tarball. `npm link` proves the repository works, not the artifact.

`package-contract` closes that gap with real consumer projects:

```text
source tree
    │
    ├─ npm pack
    ▼
immutable tarball ──► isolated npm install
                          │
                          ├─ real Node.js imports and requires
                          ├─ real TypeScript compiler API
                          ├─ every declared export subpath
                          └─ explicit API, asset, lazy import, and bin actions
```

It also runs [Publint](https://publint.dev/) and
[Are the Types Wrong](https://arethetypeswrong.github.io/) against the same
tarball. If either tool already explains a failure, `package-contract` stays
quiet by default. The useful output is the residual: reproduced consumer
failures that static analysis did not already explain.

## The 15-second setup

```sh
npm install --save-dev package-contract
npx package-contract check .
```

A healthy package prints nothing and exits with code 0.

A broken package gives you the consumer, subpath, exact command, and bounded
evidence:

```text
PC1001 Package evaluation failed
  . (ESM, Node 24.16.0)
  $ node <consumer>/probe-a28c638f5fd2.mjs
  Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  '<consumer>/node_modules/example/lazy.js'
```

That is the complete zero-configuration workflow. No config file is required.

## What it catches

- Runtime dependencies that only worked because a workspace hoisted them
- Dynamic imports whose target was omitted from the tarball
- Top-level code that reads an asset which was never packed
- JavaScript self-references blocked by the published `exports` map
- Declaration files that import undeclared type dependencies
- ESM, CommonJS, and declaration paths that disagree in real consumers
- Export patterns that resolve differently from their apparent intent
- Explicit API calls, asset reads, and package executables that fail after pack

Every failure comes from execution or compilation. Unsupported states are
`not-evaluated`, never reported as compatible.

## The default matrix

| Consumer | Runtime | TypeScript resolution |
| --- | --- | --- |
| ESM | Current Node executable | Runtime only |
| CommonJS | Current Node executable | Runtime only |
| ESM | Current Node executable | Node16 |
| ESM | Current Node executable | NodeNext |
| ESM | Current Node executable | Bundler |
| CommonJS | Current Node executable | Node16 |
| CommonJS | Current Node executable | NodeNext |

Only profiles the package claims to support are executed. Explicit export
subpaths are tested directly. Safe wildcard patterns are expanded from
JavaScript files in the packed artifact. Ambiguous patterns are
`not-evaluated`.

TypeScript is a peer dependency. The runner resolves the invoking project's
compiler and supports TypeScript 5.6, 6, and 7 through version-specific
structured adapters.

## CLI

```sh
# Check a directory by packing it first
package-contract check .

# Check the exact tarball you intend to publish
package-contract check ./example-1.2.3.tgz

# Stable machine-readable output
package-contract check . --json

# GitHub workflow annotations
package-contract check . --reporter github

# Show failures already explained by Publint or ATTW
package-contract check . --include-explained

# Prove installation can replay without network access
package-contract check . --offline

# Compare two artifacts under the same profiles and npm cache
package-contract compare ./before.tgz ./after.tgz

# Materialize a minimal consumer for one diagnostic
package-contract check . --repro <diagnostic-id>
```

Exit code 0 means no visible residual error. Exit code 1 means at least one
residual error reproduced. Exit code 2 means the invocation or check could not
complete, including an inconclusive comparison caused by dependency drift.

See the full [CLI reference](./docs/cli.md).

## Library API

```ts
import {
  comparePackages,
  defineConsumer,
  testPackage,
} from "package-contract";

const node = { executable: process.execPath, version: process.versions.node };

const esmNodeNext = defineConsumer({
  moduleSystem: "esm",
  runtime: node,
  typescriptResolution: "nodenext",
});

const report = await testPackage(
  { kind: "directory", path: "." },
  { profiles: [esmNodeNext] },
);

if (report.diagnostics.length > 0) {
  process.exitCode = 1;
}

const comparison = await comparePackages(
  { kind: "tarball", path: "./before.tgz" },
  { kind: "tarball", path: "./after.tgz" },
);
```

The public surface is deliberately small:

- `defineConsumer(profile)` validates and freezes a consumer profile.
- `testPackage(input, options)` returns a deterministic package report.
- `comparePackages(before, after, options)` classifies regressions, fixes, and
  unchanged diagnostics.
- Reporter helpers serialize JSON, human output, and GitHub annotations.

## Test behavior that imports cannot reach

Zero-configuration probes only assert resolution and evaluation. Add explicit
actions when the consumer must call an API, trigger a lazy import, read an
exported asset, or execute a bin:

```ts
const report = await testPackage(
  { kind: "directory", path: "." },
  {
    actions: [
      { kind: "export", subpath: ".", exportName: "createClient" },
      {
        kind: "call",
        subpath: ".",
        exportName: "loadAdapter",
        arguments: ["memory"],
      },
      { kind: "read-file", subpath: ".", exportName: "schemaUrl" },
    ],
    bins: [{ name: "example", arguments: ["--help"] }],
  },
);
```

Actions are validated, sorted, deeply frozen, recorded in the report, and
preserved in generated reproductions. Read the
[consumer action guide](./docs/consumer-actions.md).

## CI

```yaml
name: Package contract

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  package:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd # v5.0.1
      - uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5.0.0
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npm pack
      - run: npx package-contract check ./package-contract-*.tgz --reporter github
```

For release gates, prefer checking the exact saved tarball rather than packing
again in a later step.

## How it relates to other tools

| Tool | Its job | Why `package-contract` still runs |
| --- | --- | --- |
| Publint | Static package metadata and file analysis | It cannot observe evaluation-time behavior or a clean consumer dependency graph |
| Are the Types Wrong | Static runtime-to-types resolution analysis | It does not compile a real consumer with the invoking TypeScript |
| `npm pack --dry-run` | Packed file inventory | A file list has no runtime semantics |
| pkg.pr.new | Installable preview packages | Verification remains manual |

Publint and Are the Types Wrong are runtime dependencies, not competitors.
Their structured findings prevent duplicate diagnostics. The exact dependency
rationale is documented in [docs/dependencies.md](./docs/dependencies.md).

## Determinism and offline operation

Reports normalize path separators, line endings, ANSI sequences, locale, and
ordering. Temporary source, tarball, consumer, cache, and compiler paths are
redacted before serialization. Diagnostic identity is a stable hash of code,
profile, and subpath.

Byte identity is guaranteed for the same tarball, environment, tool versions,
profile schema, and resolved dependency graph. Reports record those inputs and
the normalized lockfile digest.

Normal mode may use the npm registry to install package dependencies. Strict
offline mode passes `--offline`; a cache miss becomes `not-evaluated`.

## Security boundary

`package-contract` is a release test runner, not a sandbox or malware scanner.

- `npm pack` can execute lifecycle scripts from a directory under test.
- Runtime probes deliberately execute the packed package.
- Consumer installation disables lifecycle scripts by default.
- Local directories and tarballs are trusted inputs in v1.
- Registry URLs, Git URLs, and arbitrary npm specifiers are rejected.
- Child processes have closed stdin, bounded output, timeouts, scrubbed
  environments, isolated npm configuration, and process-tree termination.
- Tarballs are copied into a private immutable artifact before validation and
  installation.

Do not run it on code you would not otherwise build and test. Read the complete
[security policy](./SECURITY.md).

## Requirements and limits

- Node.js 24 or newer
- npm synthetic consumers
- TypeScript 5.6 through 7
- ESM package distribution
- Local package directories and `.tgz` files only

Browser, bundler-runtime, Deno, Bun, Workers, pnpm, and Yarn consumer matrices
are outside v1. Bundler in the matrix refers to TypeScript's
`moduleResolution: "Bundler"`, not execution in a simulated bundler.

## Evidence

The project began with ten deliberately broken packages. Six failures were
empirically invisible to Publint 0.3.22 and Are the Types Wrong 0.18.5, which
met the product's feasibility gate. The
[feasibility report](./research/m0/README.md) records the exact classifications.

The clean-package validation currently includes full discovered matrices for
Nanoid, p-limit, Picocolors, SemVer, and Zod with zero residual findings. See
[the recorded validation](./docs/validation/clean-packages.md).

## Contributing

Packaging behavior is subtle, and focused real-world fixtures are especially
valuable. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull
request or proposing a diagnostic.

## License

[MIT](./LICENSE) © 2026 Alex Berriman
