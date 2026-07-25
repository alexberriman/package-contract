# Contributing

Thanks for helping make npm releases more dependable.

## Before opening an issue

Search existing issues and confirm the failure occurs against a packed tarball,
not a source directory, workspace link, or test-runner alias. Include:

- package name and exact version, when public;
- Node.js, npm, and TypeScript versions;
- the smallest affected export subpath and profile;
- normalized command output;
- whether Publint or Are the Types Wrong reports a matching problem.

Never attach credentials, private registry configuration, or a proprietary
package without permission.

Security vulnerabilities belong in the private process described by
[SECURITY.md](./SECURITY.md).

## Development

Requirements:

- Node.js 24 or newer
- npm 12.0.1

```sh
npm ci
npm run check
npm run test:coverage
npm run build
```

Biome owns formatting and linting. Run `npm run format` before committing.
Tests use Vitest and should not depend on a developer's global npm
configuration, credentials, cache, or workspace layout.

## Fixture standard

Every new diagnostic or suppression rule needs:

1. one minimal package that reproduces the failure from its tarball;
2. one clean counter-fixture that must not fail;
3. recorded Publint and Are the Types Wrong behavior;
4. assertions for stable code, profile, subpath, evidence, and explanation;
5. deterministic cleanup and bounded execution.

A fixture should isolate one packaging behavior. Avoid realistic application
scaffolding when four files can prove the same claim.

Unknown incumbent codes, wildcard-adjacent paths, or unrelated findings must
never suppress a diagnostic. Precision takes priority over recall.

## Changes

Use conventional commit subjects:

```text
feat: add an explicit asset consumer action
fix: preserve scoped package subpaths
test: cover concurrent npm cache replay
docs: clarify the lifecycle script boundary
```

Keep public API additions small and justified by a consumer contract. Avoid
convenience dependencies when Node.js provides the required primitive. Any
runtime dependency needs a written rationale in
[docs/dependencies.md](./docs/dependencies.md).

By participating, you agree to follow the
[Code of Conduct](./CODE_OF_CONDUCT.md).
