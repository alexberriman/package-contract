# Dependency policy

`package-contract` uses Node.js built-ins for its runner, process management,
archive validation, hashing, temporary files, and reporters. A runtime
dependency is accepted only when it supplies product-defining analysis that
would be unsafe or strategically wrong to duplicate.

## Runtime dependencies

### `publint`

Publint is the established static package linter that `package-contract`
complements. Its programmatic API supplies stable message codes and package
locations for the exact packed artifact. Those findings are required to avoid
presenting an execution failure as novel when Publint already explains it.
Reimplementing its rules would add a competing, lower-quality static linter.

### `@publint/pack`

Publint accepts an in-memory tarball through the archive representation provided
by `@publint/pack`. Using the official unpacker keeps the adapter on Publint's
supported path and ensures its analysis sees the same immutable tarball bytes as
the execution probes. `package-contract` still performs its own deliberately
strict archive validation at the trust boundary.

### `@arethetypeswrong/core`

Are the Types Wrong is the established static analysis engine for package type
resolution. Its structured problem kinds, entrypoints, and resolution modes are
needed to correlate compiler failures with an existing explanation. The core
package is used directly, without its CLI or network APIs, against the same
local tarball.

## Development dependencies

- TypeScript is a peer dependency because probes must use the invoking
  project's compiler. Versions 5.6, 6, and 7 are installed under test-only
  aliases to exercise every supported adapter.
- Biome provides formatting and linting.
- Vitest and its V8 coverage provider run the test suite and enforce coverage
  gates.
- `@types/node` supplies Node.js declarations during development.

All dependency versions are exact in `package.json` and locked by
`package-lock.json`. Release checks include production audit and license review.
