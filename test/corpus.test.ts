import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  BinActionInput,
  ConsumerProfileInput,
  RuntimeActionInput,
} from "../src/index.js";
import { testPackage } from "../src/index.js";

const execFileAsync = promisify(execFile);

type Expected =
  | { readonly class: "clean" }
  | { readonly class: "explained"; readonly code: string }
  | { readonly class: "not-evaluated"; readonly reason: string }
  | { readonly class: "residual"; readonly code: string };

interface CorpusCase {
  readonly actions?: readonly RuntimeActionInput[];
  readonly bins?: readonly BinActionInput[];
  readonly expected: Expected;
  readonly files: Readonly<Record<string, string>>;
  readonly id: string;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly profile: ConsumerProfileInput;
}

const runtime = { version: process.version };
const esmProfile: ConsumerProfileInput = {
  moduleSystem: "esm",
  runtime,
};
const cjsProfile: ConsumerProfileInput = {
  moduleSystem: "cjs",
  runtime,
};
const esmTypes: ConsumerProfileInput = {
  moduleSystem: "esm",
  runtime,
  typescriptResolution: "nodenext",
};

function esmManifest(id: string): Record<string, unknown> {
  return {
    exports: {
      ".": {
        types: "./index.d.ts",
        import: "./index.js",
      },
    },
    files: ["index.js", "index.d.ts"],
    name: `package-contract-corpus-${id}`,
    type: "module",
    version: "1.0.0",
  };
}

function cjsManifest(id: string): Record<string, unknown> {
  return {
    exports: {
      ".": {
        types: "./index.d.cts",
        require: "./index.cjs",
      },
    },
    files: ["index.cjs", "index.d.cts"],
    name: `package-contract-corpus-${id}`,
    type: "commonjs",
    version: "1.0.0",
  };
}

function esmRuntimeCase(
  id: string,
  source: string,
  options: {
    readonly actions?: readonly RuntimeActionInput[];
    readonly manifest?: Readonly<Record<string, unknown>>;
    readonly files?: Readonly<Record<string, string>>;
  } = {},
): CorpusCase {
  return {
    ...(options.actions === undefined ? {} : { actions: options.actions }),
    expected: { class: "residual", code: "PC1001" },
    files: {
      "index.d.ts": "export declare const value: unknown;\n",
      "index.js": source,
      ...options.files,
    },
    id,
    manifest: { ...esmManifest(id), ...options.manifest },
    profile: esmProfile,
  };
}

function cjsRuntimeCase(
  id: string,
  source: string,
  actions?: readonly RuntimeActionInput[],
): CorpusCase {
  return {
    ...(actions === undefined ? {} : { actions }),
    expected: { class: "residual", code: "PC1001" },
    files: {
      "index.cjs": source,
      "index.d.cts": "export declare const value: unknown;\n",
    },
    id,
    manifest: cjsManifest(id),
    profile: cjsProfile,
  };
}

const cases: readonly CorpusCase[] = [
  esmRuntimeCase(
    "r01-top-level-text-asset",
    "import { readFileSync } from 'node:fs';\nexport const value = readFileSync(new URL('./missing.txt', import.meta.url));\n",
  ),
  esmRuntimeCase(
    "r02-top-level-json-asset",
    "import { readFileSync } from 'node:fs';\nexport const value = JSON.parse(readFileSync(new URL('./missing.json', import.meta.url), 'utf8'));\n",
  ),
  esmRuntimeCase(
    "r03-undeclared-esm-dependency",
    "import value from 'package-contract-missing-runtime';\nexport { value };\n",
  ),
  esmRuntimeCase(
    "r04-blocked-esm-self-reference",
    "import value from 'package-contract-corpus-r04-blocked-esm-self-reference/private';\nexport { value };\n",
    {
      files: { "private.js": "export default 42;\n" },
      manifest: {
        files: ["index.js", "index.d.ts", "private.js"],
      },
    },
  ),
  esmRuntimeCase(
    "r05-lazy-dynamic-import",
    "export const value = 42;\nexport const load = () => import('./lazy.js');\n",
    {
      actions: [{ exportName: "load", kind: "call", subpath: "." }],
    },
  ),
  esmRuntimeCase(
    "r06-exported-url-asset",
    "export const value = new URL('./missing.txt', import.meta.url);\n",
    {
      actions: [{ exportName: "value", kind: "read-file", subpath: "." }],
    },
  ),
  esmRuntimeCase(
    "r07-function-reads-asset",
    "import { readFile } from 'node:fs/promises';\nexport const value = () => readFile(new URL('./missing.txt', import.meta.url));\n",
    {
      actions: [{ exportName: "value", kind: "call", subpath: "." }],
    },
  ),
  esmRuntimeCase(
    "r08-function-imports-dependency",
    "export const value = () => import('package-contract-missing-lazy');\n",
    {
      actions: [{ exportName: "value", kind: "call", subpath: "." }],
    },
  ),
  esmRuntimeCase("r09-subpath-missing-asset", "export const value = 42;\n", {
    actions: [
      {
        exportName: "feature",
        kind: "export",
        subpath: "./feature",
      },
    ],
    files: {
      "feature.d.ts": "export declare const feature: unknown;\n",
      "feature.js":
        "import { readFileSync } from 'node:fs';\nexport const feature = readFileSync(new URL('./feature.txt', import.meta.url));\n",
    },
    manifest: {
      exports: {
        ".": {
          types: "./index.d.ts",
          import: "./index.js",
        },
        "./feature": {
          types: "./feature.d.ts",
          import: "./feature.js",
        },
      },
      files: ["index.js", "index.d.ts", "feature.js", "feature.d.ts"],
    },
  }),
  esmRuntimeCase("r10-explicit-export-contract", "export const value = 42;\n", {
    actions: [
      {
        exportName: "requiredByContract",
        kind: "export",
        subpath: ".",
      },
    ],
  }),
  cjsRuntimeCase(
    "r11-top-level-cjs-asset",
    "const { readFileSync } = require('node:fs');\nexports.value = readFileSync(__dirname + '/missing.txt');\n",
  ),
  cjsRuntimeCase(
    "r12-undeclared-cjs-dependency",
    "exports.value = require('package-contract-missing-cjs');\n",
  ),
  {
    expected: { class: "residual", code: "PC1001" },
    files: {
      "index.cjs":
        "exports.value = require('package-contract-corpus-r13-blocked-cjs-self-reference/private');\n",
      "index.d.cts": "export declare const value: unknown;\n",
      "private.cjs": "module.exports = 42;\n",
    },
    id: "r13-blocked-cjs-self-reference",
    manifest: {
      ...cjsManifest("r13-blocked-cjs-self-reference"),
      files: ["index.cjs", "index.d.cts", "private.cjs"],
    },
    profile: cjsProfile,
  },
  cjsRuntimeCase(
    "r14-lazy-cjs-require",
    "exports.value = () => require('./missing.cjs');\n",
    [{ exportName: "value", kind: "call", subpath: "." }],
  ),
  {
    bins: [{ arguments: ["--fail"], name: "corpus-bin" }],
    expected: { class: "residual", code: "PC1004" },
    files: {
      "cli.js":
        "#!/usr/bin/env node\nif (process.argv.includes('--fail')) throw new Error('failure');\n",
      "index.d.ts": "export declare const value: number;\n",
      "index.js": "export const value = 42;\n",
    },
    id: "r15-bin-explicit-failure",
    manifest: {
      ...esmManifest("r15-bin-explicit-failure"),
      bin: { "corpus-bin": "./cli.js" },
      files: ["index.js", "index.d.ts", "cli.js"],
    },
    profile: esmProfile,
  },
  {
    bins: [{ name: "corpus-bin" }],
    expected: { class: "residual", code: "PC1004" },
    files: {
      "cli.js":
        "#!/usr/bin/env node\nrequire('node:fs').readFileSync(__dirname + '/missing.txt');\n",
      "index.d.ts": "export declare const value: number;\n",
      "index.js": "export const value = 42;\n",
    },
    id: "r16-bin-missing-asset",
    manifest: {
      ...esmManifest("r16-bin-missing-asset"),
      bin: { "corpus-bin": "./cli.js" },
      files: ["index.js", "index.d.ts", "cli.js"],
    },
    profile: esmProfile,
  },
  {
    bins: [{ name: "corpus-bin" }],
    expected: { class: "residual", code: "PC1004" },
    files: {
      "cli.js": "#!/usr/bin/env node\nrequire('package-contract-missing-bin');\n",
      "index.d.ts": "export declare const value: number;\n",
      "index.js": "export const value = 42;\n",
    },
    id: "r17-bin-missing-dependency",
    manifest: {
      ...esmManifest("r17-bin-missing-dependency"),
      bin: { "corpus-bin": "./cli.js" },
      files: ["index.js", "index.d.ts", "cli.js"],
    },
    profile: esmProfile,
  },
  {
    expected: { class: "residual", code: "PC1002" },
    files: {
      "index.d.ts":
        "import type { Missing } from 'package-contract-missing-types';\nexport declare const value: Missing;\n",
      "index.js": "export const value = 42;\n",
    },
    id: "r18-undeclared-type-dependency",
    manifest: esmManifest("r18-undeclared-type-dependency"),
    profile: esmTypes,
  },
  {
    expected: { class: "residual", code: "PC1002" },
    files: {
      "index.d.ts":
        "import type { Missing } from './missing.js';\nexport declare const value: Missing;\n",
      "index.js": "export const value = 42;\n",
    },
    id: "r19-omitted-relative-declaration",
    manifest: esmManifest("r19-omitted-relative-declaration"),
    profile: esmTypes,
  },
  {
    expected: { class: "residual", code: "PC1002" },
    files: {
      "feature.d.ts":
        "import type { Missing } from 'package-contract-missing-feature-types';\nexport declare const feature: Missing;\n",
      "feature.js": "export const feature = 42;\n",
      "index.d.ts": "export declare const value: number;\n",
      "index.js": "export const value = 42;\n",
    },
    id: "r20-subpath-type-dependency",
    manifest: {
      ...esmManifest("r20-subpath-type-dependency"),
      exports: {
        ".": { types: "./index.d.ts", import: "./index.js" },
        "./feature": {
          types: "./feature.d.ts",
          import: "./feature.js",
        },
      },
      files: ["index.js", "index.d.ts", "feature.js", "feature.d.ts"],
    },
    profile: { ...esmTypes, subpaths: ["./feature"] },
  },
  {
    expected: { class: "clean" },
    files: {
      "index.d.ts": "export declare const value: number;\n",
      "index.js": "export const value = 42;\n",
    },
    id: "c01-clean-esm",
    manifest: esmManifest("c01-clean-esm"),
    profile: esmProfile,
  },
  {
    expected: { class: "clean" },
    files: {
      "index.cjs": "exports.value = 42;\n",
      "index.d.cts": "export declare const value: number;\n",
    },
    id: "c02-clean-cjs",
    manifest: cjsManifest("c02-clean-cjs"),
    profile: cjsProfile,
  },
  {
    actions: [{ exportName: "load", kind: "call", subpath: "." }],
    expected: { class: "clean" },
    files: {
      "index.d.ts": "export declare function load(): Promise<number>;\n",
      "index.js": "export async function load() { return 42; }\n",
    },
    id: "c03-clean-action",
    manifest: esmManifest("c03-clean-action"),
    profile: esmProfile,
  },
  {
    bins: [{ arguments: ["--help"], name: "corpus-bin" }],
    expected: { class: "clean" },
    files: {
      "cli.js": "#!/usr/bin/env node\nprocess.stdout.write('help\\n');\n",
      "index.d.ts": "export declare const value: number;\n",
      "index.js": "export const value = 42;\n",
    },
    id: "c04-clean-bin",
    manifest: {
      ...esmManifest("c04-clean-bin"),
      bin: { "corpus-bin": "./cli.js" },
      files: ["index.js", "index.d.ts", "cli.js"],
    },
    profile: esmProfile,
  },
  {
    expected: { class: "clean" },
    files: {
      "feature.js": "export const feature = 42;\n",
      "index.d.ts": "export declare const value: number;\n",
      "index.js": "export const value = 42;\n",
    },
    id: "c05-clean-pattern",
    manifest: {
      ...esmManifest("c05-clean-pattern"),
      exports: {
        ".": { types: "./index.d.ts", import: "./index.js" },
        "./features/*": "./*.js",
      },
      files: ["index.js", "index.d.ts", "feature.js"],
    },
    profile: { ...esmProfile, subpaths: ["./features/feature"] },
  },
  {
    expected: { class: "clean" },
    files: {
      "index.d.ts": "export declare const value: number;\n",
      "index.js": "export const value = 42;\n",
    },
    id: "c06-clean-types",
    manifest: esmManifest("c06-clean-types"),
    profile: esmTypes,
  },
  {
    expected: { class: "explained", code: "PC1001" },
    files: {
      "index.d.ts": "export declare const value: number;\n",
      "index.js": "export const value = 42;\n",
    },
    id: "e01-missing-export-target",
    manifest: {
      ...esmManifest("e01-missing-export-target"),
      exports: {
        ".": { types: "./index.d.ts", import: "./missing.js" },
      },
    },
    profile: esmProfile,
  },
  {
    expected: { class: "clean" },
    files: {
      "index.d.ts": "export declare const value: number;\n",
      "index.js": "export const value = 42;\n",
    },
    id: "s01-static-types-order",
    manifest: {
      ...esmManifest("s01-static-types-order"),
      exports: {
        ".": { import: "./index.js", types: "./index.d.ts" },
      },
    },
    profile: esmTypes,
  },
  {
    expected: { class: "explained", code: "PC1001" },
    files: {
      "index.d.ts": "export declare const value: number;\n",
      "index.js": "await Promise.resolve();\nexport const value = 42;\n",
    },
    id: "e03-require-esm-tla",
    manifest: {
      ...esmManifest("e03-require-esm-tla"),
      exports: {
        ".": {
          types: "./index.d.ts",
          import: "./index.js",
          require: "./index.js",
        },
      },
    },
    profile: cjsProfile,
  },
  {
    expected: { class: "not-evaluated", reason: "inapplicable-profile" },
    files: { "index.js": "export const value = 42;\n" },
    id: "n01-untyped-typescript",
    manifest: {
      exports: { ".": { import: "./index.js" } },
      files: ["index.js"],
      name: "package-contract-corpus-n01-untyped-typescript",
      type: "module",
      version: "1.0.0",
    },
    profile: esmTypes,
  },
];

let root = "";

async function packFixture(fixture: CorpusCase): Promise<string> {
  const directory = join(root, fixture.id);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    `${JSON.stringify(fixture.manifest, null, 2)}\n`,
  );
  for (const [path, contents] of Object.entries(fixture.files)) {
    const file = join(directory, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
  const { stdout } = await execFileAsync(
    "npm",
    ["pack", "--ignore-scripts", "--json"],
    { cwd: directory },
  );
  const [{ filename }] = JSON.parse(stdout);
  return join(directory, filename);
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "package-contract-corpus-test-"));
});

afterAll(async () => {
  await rm(root, { force: true, recursive: true });
});

describe("fixture corpus", () => {
  it("contains at least thirty focused cases and twenty residual failures", () => {
    expect(cases).toHaveLength(30);
    expect(cases.filter(({ expected }) => expected.class === "residual")).toHaveLength(
      20,
    );
  });

  it.each(cases)("$id", async (fixture) => {
    const tarball = await packFixture(fixture);
    const report = await testPackage(
      { kind: "tarball", path: tarball },
      {
        ...(fixture.actions === undefined ? {} : { actions: fixture.actions }),
        ...(fixture.bins === undefined ? {} : { bins: fixture.bins }),
        includeExplained: fixture.expected.class === "explained",
        profiles: [fixture.profile],
      },
    );

    switch (fixture.expected.class) {
      case "clean":
        expect(report.diagnostics).toEqual([]);
        expect(report.results.every(({ state }) => state === "pass")).toBe(true);
        break;
      case "residual":
        expect(report.diagnostics).toContainEqual(
          expect.objectContaining({
            code: fixture.expected.code,
            explainedBy: null,
          }),
        );
        break;
      case "explained":
        expect(report.diagnostics).toContainEqual(
          expect.objectContaining({
            code: fixture.expected.code,
            explainedBy: expect.any(Array),
          }),
        );
        expect(
          report.diagnostics.every(({ explainedBy }) => explainedBy !== null),
        ).toBe(true);
        break;
      case "not-evaluated":
        expect(report.diagnostics).toEqual([]);
        expect(report.results).toContainEqual(
          expect.objectContaining({
            reason: expect.objectContaining({
              code: fixture.expected.reason,
            }),
            state: "not-evaluated",
          }),
        );
        break;
    }
  });
});
