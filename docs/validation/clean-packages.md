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
| `zod` | 4.4.3 | Full discovered matrix | 0 |

Zod produced 814 explicit matrix results from its large wildcard export
surface. The first implementation spawned a compiler for every subpath and was
stopped as unacceptably slow. The recorded run batches every subpath for a
profile into one compiler worker, completed in 63 seconds, and produced zero
residual or explained failures.

This corpus is evidence against false positives, not a universal compatibility
claim. It is rerun during release auditing with exact versions recorded in the
result.
