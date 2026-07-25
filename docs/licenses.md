# Production dependency licenses

Release preparation audits every installed production package against an
allowlist of permissive SPDX licenses. A missing or changed license fails the
release gate.

The exact npm 12.0.1 lockfile currently resolves:

| Package | Version | License |
| --- | ---: | --- |
| `@andrewbranch/untar.js` | 1.0.3 | MIT, verified from bundled license text |
| `@arethetypeswrong/core` | 0.18.5 | MIT |
| `@braidai/lang` | 1.1.2 | ISC |
| `@loaderkit/resolve` | 1.0.6 | ISC |
| `@publint/pack` | 0.1.6 | MIT |
| `cjs-module-lexer` | 1.4.3 | MIT |
| `fflate` | 0.8.3 | MIT |
| `lru-cache` | 11.5.2 | BlueOak-1.0.0 |
| `mri` | 1.2.0 | MIT |
| `package-manager-detector` | 1.8.0 | MIT |
| `picocolors` | 1.1.1 | ISC |
| `publint` | 0.3.22 | MIT |
| `sade` | 1.8.1 | MIT |
| `semver` | 7.8.5 | ISC |
| `tinyexec` | 1.2.4 | MIT |
| `typescript` | 5.6.1-rc | Apache-2.0 |
| `validate-npm-package-name` | 5.0.1 | ISC |

The TypeScript version in this table is ATTW's internal analysis dependency.
Consumer compilation uses the invoking project's peer compiler instead.
