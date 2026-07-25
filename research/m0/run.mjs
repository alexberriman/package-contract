import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const toolRoot = process.env.M0_TOOL_ROOT;
if (!toolRoot) {
  throw new Error("M0_TOOL_ROOT must point to the isolated tool installation");
}

const publint = join(toolRoot, "node_modules", ".bin", "publint");
const attw = join(toolRoot, "node_modules", ".bin", "attw");
const root = mkdtempSync(join(tmpdir(), "package-contract-m0-"));
const results = {};

const shared = {
  version: "1.0.0",
  private: true,
  type: "module",
  engines: { node: ">=24" },
};

const fixtures = [
  {
    id: "01-dynamic-import-omitted",
    packageJson: {
      ...shared,
      name: "m0-dynamic-import-omitted",
      files: ["index.js", "index.d.ts"],
      exports: { ".": { types: "./index.d.ts", import: "./index.js" } },
    },
    files: {
      "index.js": "export const load = () => import('./lazy.js');\n",
      "index.d.ts": "export declare const load: () => Promise<{ value: number }>;\n",
      "lazy.js": "export const value = 42;\n",
    },
  },
  {
    id: "02-types-condition-after-import",
    packageJson: {
      ...shared,
      name: "m0-types-condition-after-import",
      files: ["index.js", "index.d.ts"],
      exports: { ".": { import: "./index.js", types: "./index.d.ts" } },
    },
    files: {
      "index.js": "export const value = 42;\n",
      "index.d.ts": "export declare const value: number;\n",
    },
  },
  {
    id: "03-require-esm-with-tla",
    packageJson: {
      ...shared,
      name: "m0-require-esm-with-tla",
      files: ["index.js", "index.d.ts"],
      exports: {
        ".": {
          types: "./index.d.ts",
          import: "./index.js",
          require: "./index.js",
        },
      },
    },
    files: {
      "index.js": "await Promise.resolve();\nexport const value = 42;\n",
      "index.d.ts": "export declare const value: number;\n",
    },
  },
  {
    id: "04-runtime-dev-dependency",
    packageJson: {
      ...shared,
      name: "m0-runtime-dev-dependency",
      files: ["index.js", "index.d.ts"],
      exports: { ".": { types: "./index.d.ts", import: "./index.js" } },
      devDependencies: { "is-number": "7.0.0" },
    },
    files: {
      "index.js": "import isNumber from 'is-number';\nexport const value = isNumber(42);\n",
      "index.d.ts": "export declare const value: boolean;\n",
    },
  },
  {
    id: "05-js-self-reference",
    packageJson: {
      ...shared,
      name: "m0-js-self-reference",
      files: ["index.js", "index.d.ts", "internal.js"],
      exports: { ".": { types: "./index.d.ts", import: "./index.js" } },
    },
    files: {
      "index.js":
        "import { internal } from 'm0-js-self-reference/internal';\nexport const value = internal;\n",
      "index.d.ts": "export declare const value: number;\n",
      "internal.js": "export const internal = 42;\n",
    },
  },
  {
    id: "06-type-only-undeclared-dependency",
    packageJson: {
      ...shared,
      name: "m0-type-only-undeclared-dependency",
      files: ["index.js", "index.d.ts"],
      exports: { ".": { types: "./index.d.ts", import: "./index.js" } },
    },
    files: {
      "index.js": "export const value = 42;\n",
      "index.d.ts":
        "import type { External } from 'missing-type-package';\nexport declare const value: External;\n",
    },
  },
  {
    id: "07-bin-missing-shebang",
    packageJson: {
      ...shared,
      name: "m0-bin-missing-shebang",
      files: ["index.js", "index.d.ts", "cli.js"],
      exports: { ".": { types: "./index.d.ts", import: "./index.js" } },
      bin: { "m0-bin": "./cli.js" },
    },
    files: {
      "index.js": "export const value = 42;\n",
      "index.d.ts": "export declare const value: number;\n",
      "cli.js": "console.log('ok');\n",
    },
  },
  {
    id: "08-top-level-missing-asset",
    packageJson: {
      ...shared,
      name: "m0-top-level-missing-asset",
      files: ["index.js", "index.d.ts"],
      exports: { ".": { types: "./index.d.ts", import: "./index.js" } },
    },
    files: {
      "index.js":
        "import { readFileSync } from 'node:fs';\nexport const value = readFileSync(new URL('./data.txt', import.meta.url), 'utf8');\n",
      "index.d.ts": "export declare const value: string;\n",
      "data.txt": "ok\n",
    },
  },
  {
    id: "09-api-newer-than-engines",
    packageJson: {
      ...shared,
      name: "m0-api-newer-than-engines",
      engines: { node: ">=18" },
      files: ["index.js", "index.d.ts"],
      exports: { ".": { types: "./index.d.ts", import: "./index.js" } },
    },
    files: {
      "index.js":
        "import { globSync } from 'node:fs';\nexport const value = globSync('*.js');\n",
      "index.d.ts": "export declare const value: string[];\n",
    },
  },
  {
    id: "10-export-target-not-packed",
    packageJson: {
      ...shared,
      name: "m0-export-target-not-packed",
      files: ["index.js", "index.d.ts"],
      exports: {
        ".": { types: "./index.d.ts", import: "./index.js" },
        "./feature": {
          types: "./feature.d.ts",
          import: "./feature.js",
        },
      },
    },
    files: {
      "index.js": "export const value = 42;\n",
      "index.d.ts": "export declare const value: number;\n",
      "feature.js": "export const feature = true;\n",
      "feature.d.ts": "export declare const feature: boolean;\n",
    },
  },
];

function run(file, args, cwd) {
  try {
    return {
      exitCode: 0,
      output: execFileSync(file, args, {
        cwd,
        encoding: "utf8",
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      }),
    };
  } catch (error) {
    return {
      exitCode: error.status ?? 1,
      output: `${error.stdout ?? ""}${error.stderr ?? ""}`,
    };
  }
}

try {
  for (const fixture of fixtures) {
    const fixtureRoot = join(root, fixture.id);
    const packRoot = join(fixtureRoot, "packed");
    mkdirSync(packRoot, { recursive: true });
    writeFileSync(
      join(fixtureRoot, "package.json"),
      `${JSON.stringify(fixture.packageJson, null, 2)}\n`,
    );
    for (const [path, contents] of Object.entries(fixture.files)) {
      writeFileSync(join(fixtureRoot, path), contents);
    }

    const pack = run(
      "npm",
      [
        "pack",
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        packRoot,
      ],
      fixtureRoot,
    );
    if (pack.exitCode !== 0) {
      throw new Error(`Packing ${fixture.id} failed:\n${pack.output}`);
    }
    const [{ filename }] = JSON.parse(pack.output);
    const tarball = join(packRoot, filename);
    const publintResult = run(publint, ["run", tarball], fixtureRoot);
    const attwResult = run(
      attw,
      ["--format", "json", "--no-color", "--no-summary", tarball],
      fixtureRoot,
    );
    results[fixture.id] = {
      publint: publintResult,
      attw: attwResult,
    };
  }

  writeFileSync(
    new URL("./raw-results.json", import.meta.url),
    `${JSON.stringify(results, null, 2)}\n`,
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
