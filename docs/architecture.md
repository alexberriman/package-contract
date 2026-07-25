# Architecture

## Product boundary

`package-contract` executes consumer behavior that static package analysis
cannot prove. Publint and Are the Types Wrong remain authoritative for their
own static findings. A diagnostic is hidden only when a version-aware causal
mapping matches its tool, code, subpath, profile, and resolution semantics.

## Pipeline

1. Resolve a trusted local directory or tarball.
2. Use npm to pack directories into an isolated destination.
3. Copy the tarball into a private mode-0600 artifact.
4. Validate archive structure, paths, headers, checksums, size, and identity.
5. Run both incumbent analyzers against the same bytes.
6. Install the tarball into a mode-0700 npm consumer with isolated config.
7. Enumerate applicable runtime and TypeScript profiles.
8. Execute bounded runtime probes and structured compiler workers.
9. Correlate only causally matching incumbent findings.
10. Sort, redact, freeze, and report the result.

Cleanup is ownership-based. The component that creates a temporary artifact or
consumer owns its idempotent cleanup function. Caller tarballs and package
directories are never removed or modified.

## Trust model

Directories and tarballs are trusted input. Packing a directory may execute its
lifecycle scripts, and runtime probes intentionally execute package code.
Consumer installation disables lifecycle scripts. This is defense in depth,
not a sandbox.

All child processes use argument arrays with `shell: false`, closed stdin,
bounded stdout and stderr, explicit timeouts, scrubbed environment variables,
and isolated working directories. Output is normalized before it crosses the
public API boundary.

## TypeScript adapters

The compiler is resolved from the invoking project, or from an explicit local
override. TypeScript 5.6 and 6 use the classic compiler API. TypeScript 7 uses
`typescript/unstable/sync`. The unstable API is isolated in a child worker so
crashes, output, and execution time remain bounded.

All subpaths for one profile are batched into one worker invocation. Each
subpath still receives an independent generated project and structured result.

## Determinism

Stable output depends on the same tarball, environment, versions, profile
schema, and dependency graph. Object keys and collections are sorted by code
unit. Paths, ANSI sequences, locale-sensitive text, and line endings are
normalized. Reports contain no timestamps.

The normalized lockfile digest replaces the package tarball's local path,
integrity, and own version while preserving the installed dependency graph.
Comparisons with missing or different graph digests are inconclusive.
