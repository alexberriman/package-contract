# Fixture corpus

The permanent corpus lives in `test/corpus.test.ts`. Each case materializes a
minimal package, packs it with npm, runs the exact tarball through Publint
0.3.22 and Are the Types Wrong 0.18.5, installs it into an isolated consumer,
and asserts its final classification.

The corpus currently contains 33 focused packages:

- 23 empirically residual consumer failures;
- 7 clean counter-fixtures, including one static-only incumbent warning;
- 2 failures causally explained by an incumbent;
- 1 explicitly inapplicable type profile.

## Residual cases

| ID | Behavior |
| --- | --- |
| `r01-top-level-text-asset` | Omitted text asset read at module evaluation |
| `r02-top-level-json-asset` | Omitted JSON asset parsed at module evaluation |
| `r03-undeclared-esm-dependency` | Undeclared ESM runtime dependency |
| `r04-blocked-esm-self-reference` | ESM self-reference blocked by exports |
| `r05-lazy-dynamic-import` | Omitted lazy module reached by an explicit call |
| `r06-exported-url-asset` | Exported asset URL points to an omitted file |
| `r07-function-reads-asset` | Exported function reads an omitted file |
| `r08-function-imports-dependency` | Exported function lazily imports an undeclared dependency |
| `r09-subpath-missing-asset` | Exported subpath reads an omitted asset |
| `r10-explicit-export-contract` | Required named export is absent |
| `r11-top-level-cjs-asset` | CommonJS entrypoint reads an omitted asset |
| `r12-undeclared-cjs-dependency` | Undeclared CommonJS runtime dependency |
| `r13-blocked-cjs-self-reference` | CommonJS self-reference blocked by exports |
| `r14-lazy-cjs-require` | Exported function lazily requires an omitted module |
| `r15-bin-explicit-failure` | Declared executable fails for explicit arguments |
| `r16-bin-missing-asset` | Declared executable reads an omitted asset |
| `r17-bin-missing-dependency` | Declared executable requires an undeclared dependency |
| `r18-undeclared-type-dependency` | Declaration imports an undeclared package |
| `r19-omitted-relative-declaration` | Declaration imports an omitted relative file |
| `r20-subpath-type-dependency` | Subpath declaration imports an undeclared package |
| `r21-node-condition-asset` | Node export condition evaluates code that reads an omitted asset |
| `r22-platform-specific-evaluation` | Entrypoint fails on the executing host platform |
| `r23-pattern-subpath-asset` | Expanded wildcard subpath reads an omitted asset |

## Counter-fixtures and suppression

Clean cases cover ESM, CommonJS, explicit function actions, executables, export
patterns, and TypeScript declarations. The static condition-order case confirms
that an incumbent warning alone does not manufacture an execution diagnostic.

The explained cases cover a missing runtime export target and requiring ESM
with top-level await. The untyped package confirms that a requested TypeScript
profile is `not-evaluated` when the package claims no declarations.

CI also runs the original runtime-floor fixture with a real Node 18.20.8
executable while package-contract itself runs on Node 24. The same packed
module fails on its claimed Node 18 floor and passes on the supported runner.
Workspace coverage separately verifies an explicit package directory nested
inside an npm workspace and a deterministic `workspace:` installation failure.

## Adding a fixture

Every fixture must isolate one behavior and declare its expected class. A
residual case needs a clean counterexample in the same diagnostic family.
Suppression cases must assert a nonempty `explainedBy` array, while residual
cases must assert `explainedBy: null`. Never update an expectation merely to
match surprising output. Investigate the package, real consumer command, and
incumbent finding first.
