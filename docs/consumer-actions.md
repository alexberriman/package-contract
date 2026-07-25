# Explicit consumer actions

Zero-configuration checks prove that declared entrypoints resolve and evaluate.
They do not guess which exports to call, which assets to read, or which
executables are safe to invoke. Those behaviors require explicit actions.

```ts
import { testPackage } from "package-contract";

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
    bins: [{ name: "my-package", arguments: ["--help"] }],
  },
);
```

`export` checks for an own named export. `call` invokes an exported function and
awaits its result, which makes lazy dynamic imports observable. `read-file`
expects the export to contain a path string or URL and reads it from the packed
installation. Bin actions execute an npm-installed declared shim directly.

Inputs are JSON-like, validated, cloned, deeply frozen, sorted, and included in
the report so a generated reproduction preserves the exact action. Actions run
only for applicable runtime profiles. TypeScript profiles continue to test
compilation without executing package code.
