# Clean-package validation

The suppression boundary is checked against published packages that represent
ESM-only, CommonJS, typed, untyped, single-entrypoint, and multi-entrypoint
shapes. Tarballs are fetched once with `npm pack`, then all analysis and
consumer execution uses the local artifact.

Validation on 26 July 2026 used Node.js 24.16.0, TypeScript 7.0.2, Publint
0.3.22, and Are the Types Wrong 0.18.5.

| Package | Version | Scope | Residual diagnostics |
| --- | ---: | --- | ---: |
| `nanoid` | 6.0.0 | Full discovered matrix | 0 |
| `p-limit` | 7.3.1 | Full discovered matrix | 0 |
| `picocolors` | 1.1.1 | Full discovered matrix | 0 |
| `semver` | 7.8.5 | Full discovered matrix | 0 |
| `zod` | 4.4.3 | Root entrypoint, every applicable profile | 0 |

Zod's full discovered export surface was intentionally not recorded as a
release result. Its large number of entrypoints exposed that spawning a fresh
compiler process for every subpath does not meet the intended runtime budget.
Compiler batching is therefore a release gate, not a waived performance issue.

This corpus is evidence against false positives, not a universal compatibility
claim. It is rerun during release auditing with exact versions recorded in the
result.
