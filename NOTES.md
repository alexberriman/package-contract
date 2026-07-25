# Engineering notes

## 2026-07-26

- M0 passed with exactly six residual failures. The margin is zero, so fixture
  semantics and suppression matching need unusual care.
- Are the Types Wrong 0.18.5 bundles TypeScript 5.6.1-rc. Its analysis is not a
  substitute for compiling with the consumer's selected TypeScript.
- A general ATTW `CJSResolvesToESM` result does not explain an unrelated runtime
  failure. Suppression must be causal and profile-specific.
- npm normalizes a declared bin with a shebang to executable mode during pack
  and install. Missing mode alone is not the fixture the original brief
  suggested.
- `npm pack` can run lifecycle scripts. Ignoring install scripts does not make
  package testing safe for untrusted code.
- `--prefer-offline` may access the network. Strict offline operation requires
  `--offline`.
- Determinism is conditional on the tarball, environment, toolchain, profiles,
  and resolved dependency graph.
- `@publint/pack` depends on `tinyexec`, and publint already depends on
  `@publint/pack`. Add it directly only if package-contract imports its public
  API itself.
- The required incumbent integrations make literal zero production dependencies
  impossible. The acceptable target is no convenience dependencies and a small,
  justified runtime graph.
