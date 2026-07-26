import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installConsumer, runRootEsmConsumer } from "../src/core/consumer.js";
import { createDiagnostic } from "../src/core/diagnostic.js";
import { packDirectory } from "../src/core/pack.js";
import { materializeReproduction } from "../src/core/reproduction.js";
import { inspectTarball } from "../src/core/tarball.js";
import { createTemporaryDirectory } from "../src/core/temporary.js";
import { comparePackages, defineConsumer, testPackage } from "../src/index.js";
import {
  formatTypeScriptEvidence,
  runTypeScriptProbe,
} from "../src/probes/typescript.js";
import { resolveTypeScriptCompiler } from "../src/probes/typescript-resolver.js";

const execFileAsync = promisify(execFile);
let fixtureRoot = "";
let goodTarball = "";
let badTarball = "";
let dependencyTarball = "";
let typeFailureTarball = "";
let dualTarball = "";
let patternTarball = "";
let unsafePatternTarball = "";
let untypedTarball = "";
let installationFailureTarball = "";
let explainedTarball = "";
let comparisonBeforeTarball = "";
let comparisonAfterTarball = "";
let comparisonDriftBeforeTarball = "";
let comparisonDriftTarball = "";
let comparisonCoverageDriftTarball = "";
let actionTarball = "";
let binTarball = "";

function tarHeaderOffsets(tar: Buffer): number[] {
  const offsets: number[] = [];
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }
    offsets.push(offset);
    const rawSize = header
      .subarray(124, 136)
      .toString("utf8")
      .replaceAll("\0", "")
      .trim();
    const size = Number.parseInt(rawSize, 8);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return offsets;
}

function tarEntryName(tar: Buffer, offset: number): string {
  return tar
    .subarray(offset, offset + 100)
    .toString("utf8")
    .replace(/\0.*$/s, "");
}

function writeTarField(
  tar: Buffer,
  offset: number,
  start: number,
  length: number,
  value: string,
): void {
  tar.fill(0, offset + start, offset + start + length);
  tar.write(value, offset + start, length, "utf8");
}

function refreshTarChecksum(tar: Buffer, offset: number): void {
  tar.fill(32, offset + 148, offset + 156);
  let checksum = 0;
  for (let index = 0; index < 512; index += 1) {
    checksum += tar[offset + index] ?? 0;
  }
  const value = checksum.toString(8).padStart(6, "0");
  tar.write(value, offset + 148, 6, "ascii");
  tar[offset + 154] = 0;
  tar[offset + 155] = 32;
}

async function makeFixture(
  name: string,
  source: string,
  extraFiles: Record<string, string> = {},
  dependencies: Record<string, string> = {},
  manifestOverrides: Record<string, unknown> = {},
): Promise<string> {
  const directory = join(fixtureRoot, name);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    `${JSON.stringify(
      {
        name,
        version: "1.0.0",
        type: "module",
        files: ["index.js", "index.d.ts"],
        exports: {
          ".": {
            types: "./index.d.ts",
            import: "./index.js",
          },
        },
        dependencies,
        ...manifestOverrides,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(join(directory, "index.js"), source);
  await writeFile(
    join(directory, "index.d.ts"),
    "export declare const value: number;\n",
  );
  for (const [path, contents] of Object.entries(extraFiles)) {
    const file = join(directory, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
  const { stdout } = await execFileAsync(
    "npm",
    ["pack", "--ignore-scripts", "--json"],
    { cwd: directory },
  );
  const [{ filename }] = JSON.parse(stdout) as [{ filename: string }];
  return join(directory, filename);
}

beforeAll(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), "package-contract-runner-test-"));
  goodTarball = await makeFixture(
    "package-contract-good-fixture",
    "export const value = 42;\n",
  );
  badTarball = await makeFixture(
    "package-contract-bad-fixture",
    "import { readFileSync } from 'node:fs';\nreadFileSync(new URL('./missing.txt', import.meta.url));\nexport const value = 42;\n",
  );
  dependencyTarball = await makeFixture(
    "package-contract-dependency-fixture",
    "import isNumber from 'is-number';\nexport const value = isNumber(42);\n",
    {},
    { "is-number": "7.0.0" },
  );
  typeFailureTarball = await makeFixture(
    "package-contract-type-failure-fixture",
    "export const value = 42;\n",
    {
      "index.d.ts":
        "import type { Missing } from 'package-contract-missing-type';\nexport declare const value: Missing;\n",
    },
  );
  dualTarball = await makeFixture(
    "package-contract-dual-fixture",
    "export const value = 42;\n",
    {
      "index.cjs": "exports.value = 42;\n",
      "index.d.cts": "export declare const value: number;\n",
    },
    {},
    {
      exports: {
        ".": {
          import: {
            types: "./index.d.ts",
            default: "./index.js",
          },
          require: {
            types: "./index.d.cts",
            default: "./index.cjs",
          },
        },
      },
      files: ["index.js", "index.d.ts", "index.cjs", "index.d.cts"],
    },
  );
  patternTarball = await makeFixture(
    "package-contract-pattern-fixture",
    "export const value = 42;\n",
    { "features/a.js": "export const feature = true;\n" },
    {},
    {
      exports: {
        ".": {
          types: "./index.d.ts",
          import: "./index.js",
        },
        "./features/*": "./features/*.js",
      },
      files: ["index.js", "index.d.ts", "features"],
    },
  );
  unsafePatternTarball = await makeFixture(
    "package-contract-unsafe-pattern-fixture",
    "export const value = 42;\n",
    { "features/a.js": "export const feature = true;\n" },
    {},
    {
      exports: {
        ".": {
          types: "./index.d.ts",
          import: "./index.js",
        },
        "./features/*": "./features/no-placeholder.js",
      },
      files: ["index.js", "index.d.ts", "features"],
    },
  );
  untypedTarball = await makeFixture(
    "package-contract-untyped-fixture",
    "export const value = 42;\n",
    {},
    {},
    {
      exports: { ".": { import: "./index.js" } },
      files: ["index.js"],
    },
  );
  installationFailureTarball = await makeFixture(
    "package-contract-installation-failure-fixture",
    "export const value = 42;\n",
    {},
    { "package-contract-workspace-only": "workspace:*" },
    {
      bin: { "contract-fixture": "./index.js" },
    },
  );
  explainedTarball = await makeFixture(
    "package-contract-explained-fixture",
    "export const value = 42;\n",
    {},
    {},
    {
      exports: {
        ".": {
          types: "./index.d.ts",
          import: "./missing.js",
        },
      },
    },
  );
  comparisonBeforeTarball = await makeFixture(
    "package-contract-compare-before",
    "export const value = 42;\n",
    {},
    {},
    { name: "package-contract-compare-fixture" },
  );
  comparisonAfterTarball = await makeFixture(
    "package-contract-compare-after",
    "import { readFileSync } from 'node:fs';\nreadFileSync(new URL('./missing.txt', import.meta.url));\nexport const value = 42;\n",
    {},
    {},
    { name: "package-contract-compare-fixture" },
  );
  comparisonDriftBeforeTarball = await makeFixture(
    "package-contract-compare-drift-before",
    "export const value = 42;\n",
    {},
    {
      "is-number": "7.0.0",
      picocolors: "1.1.1",
    },
    { name: "package-contract-compare-fixture" },
  );
  comparisonDriftTarball = await makeFixture(
    "package-contract-compare-drift",
    "export const value = 42;\n",
    {},
    { "is-number": "7.0.0" },
    { name: "package-contract-compare-fixture" },
  );
  comparisonCoverageDriftTarball = await makeFixture(
    "package-contract-compare-coverage-drift",
    "export const value = 42;\n",
    {
      "index.cjs": "exports.value = 42;\n",
    },
    {},
    {
      exports: {
        ".": {
          require: "./index.cjs",
          types: "./index.d.ts",
        },
      },
      files: ["index.js", "index.d.ts", "index.cjs"],
      name: "package-contract-compare-fixture",
    },
  );
  actionTarball = await makeFixture(
    "package-contract-action-fixture",
    [
      "export const asset = new URL('./missing.txt', import.meta.url);",
      "export async function load() { await import('./missing.js'); }",
      "export function sum(left, right) { return left + right; }",
      "export const value = 42;",
      "",
    ].join("\n"),
    {
      "index.d.ts": [
        "export declare const asset: URL;",
        "export declare function load(): Promise<void>;",
        "export declare function sum(left: number, right: number): number;",
        "export declare const value: number;",
        "",
      ].join("\n"),
    },
  );
  binTarball = await makeFixture(
    "package-contract-bin-fixture",
    "export const value = 42;\n",
    {
      "cli.js":
        "#!/usr/bin/env node\nif (process.argv.includes('--fail')) throw new Error('requested failure');\n",
    },
    {},
    {
      bin: { "fixture-cli": "./cli.js" },
      files: ["index.js", "index.d.ts", "cli.js"],
    },
  );
});

describe("TypeScript compiler adapter", () => {
  it("resolves TypeScript 7 from the invoking project", async () => {
    const compiler = await resolveTypeScriptCompiler({
      invokingDirectory: process.cwd(),
    });

    expect(compiler).toMatchObject({
      kind: "native",
      version: "7.0.2",
    });
    expect(compiler?.apiEntryPath).toContain("typescript");
  });

  it("returns null for an unavailable explicit compiler", async () => {
    await expect(
      resolveTypeScriptCompiler({
        invokingDirectory: process.cwd(),
        typescriptPath: join(fixtureRoot, "missing-typescript"),
      }),
    ).resolves.toBeNull();
  });

  it("accepts an explicit TypeScript package directory", async () => {
    const compiler = await resolveTypeScriptCompiler({
      invokingDirectory: fixtureRoot,
      typescriptPath: join(process.cwd(), "node_modules", "typescript"),
    });

    expect(compiler).toMatchObject({ kind: "native", version: "7.0.2" });
  });

  it("returns structured native compiler diagnostics", async () => {
    const compiler = await resolveTypeScriptCompiler({
      invokingDirectory: process.cwd(),
    });
    expect(compiler).not.toBeNull();
    if (compiler === null) {
      throw new Error("expected the development TypeScript compiler");
    }

    const artifact = await inspectTarball(typeFailureTarball);
    const consumer = await runRootEsmConsumer(artifact);
    try {
      expect(consumer.install.exitCode).toBe(0);
      const profile = defineConsumer({
        moduleSystem: "esm",
        runtime: { version: process.version },
        typescriptResolution: "nodenext",
      });
      const result = await runTypeScriptProbe(
        compiler,
        consumer,
        artifact.name,
        profile,
        ".",
      );

      expect(result.status).toBe("completed");
      if (result.status !== "completed") {
        throw new Error(result.message);
      }
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          category: "error",
          code: 2307,
          fileName: expect.stringContaining("<consumer>"),
        }),
      );
      expect(formatTypeScriptEvidence(result.diagnostics)).toContain("TS2307");
      expect(JSON.stringify(result)).not.toContain(consumer.path);
      expect(JSON.stringify(result)).not.toContain(compiler.packagePath);
    } finally {
      await Promise.all([consumer.cleanup(), artifact.cleanup()]);
    }
  });

  it.each([
    ["typescript-5-6", "5.6.3"],
    ["typescript-6", "6.0.3"],
  ])(
    "returns structured diagnostics through the classic %s adapter",
    async (directory, version) => {
      const compiler = await resolveTypeScriptCompiler({
        invokingDirectory: fixtureRoot,
        typescriptPath: join(process.cwd(), "node_modules", directory),
      });
      expect(compiler).toMatchObject({ kind: "classic", version });
      if (compiler === null) {
        throw new Error("expected the classic TypeScript compiler");
      }

      const artifact = await inspectTarball(typeFailureTarball);
      const consumer = await runRootEsmConsumer(artifact);
      try {
        const profile = defineConsumer({
          moduleSystem: "esm",
          runtime: { version: process.version },
          typescriptResolution: "nodenext",
        });
        const result = await runTypeScriptProbe(
          compiler,
          consumer,
          artifact.name,
          profile,
          ".",
        );
        expect(result.status).toBe("completed");
        if (result.status !== "completed") {
          throw new Error(result.message);
        }
        expect(result.diagnostics).toContainEqual(
          expect.objectContaining({ category: "error", code: 2307 }),
        );
      } finally {
        await Promise.all([consumer.cleanup(), artifact.cleanup()]);
      }
    },
  );
});

afterAll(async () => {
  await rm(fixtureRoot, { force: true, recursive: true });
});

describe("inspectTarball", () => {
  it("reads package identity and files without extracting them", async () => {
    const artifact = await inspectTarball(goodTarball);

    expect(artifact.name).toBe("package-contract-good-fixture");
    expect(artifact.version).toBe("1.0.0");
    expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(artifact.integrity).toMatch(/^sha512-/);
    expect(artifact.files.map(({ path }) => path)).toEqual([
      "index.d.ts",
      "index.js",
      "package.json",
    ]);
  });

  it("rejects data that is not a gzip tarball", async () => {
    const invalid = join(fixtureRoot, "invalid.tgz");
    await writeFile(invalid, "invalid");

    await expect(inspectTarball(invalid)).rejects.toThrow();
  });

  it("rejects a tar header with an invalid checksum", async () => {
    const compressed = await readFile(goodTarball);
    const tar = gunzipSync(compressed);
    tar[0] = tar[0] === 112 ? 113 : 112;
    const invalid = join(fixtureRoot, "invalid-checksum.tgz");
    await writeFile(invalid, gzipSync(tar));

    await expect(inspectTarball(invalid)).rejects.toThrow(
      "tarball contains an invalid header checksum",
    );
  });

  it.each([
    [
      "invalid numeric header",
      (tar: Buffer, offset: number) => {
        writeTarField(tar, offset, 100, 8, "not-octal");
        refreshTarChecksum(tar, offset);
      },
      "invalid numeric header",
    ],
    [
      "unsafe absolute path",
      (tar: Buffer, offset: number) => {
        writeTarField(tar, offset, 0, 100, "/unsafe.js");
        refreshTarChecksum(tar, offset);
      },
      "unsafe entry path",
    ],
    [
      "ambiguous parent path",
      (tar: Buffer, offset: number) => {
        writeTarField(tar, offset, 0, 100, "package/../unsafe.js");
        refreshTarChecksum(tar, offset);
      },
      "ambiguous entry path",
    ],
    [
      "unsupported link",
      (tar: Buffer, offset: number) => {
        writeTarField(tar, offset, 156, 1, "2");
        refreshTarChecksum(tar, offset);
      },
      "unsupported entry type",
    ],
    [
      "entry beyond archive",
      (tar: Buffer, offset: number) => {
        writeTarField(tar, offset, 124, 12, "77777777777");
        refreshTarChecksum(tar, offset);
      },
      "entry extends beyond",
    ],
  ])("rejects a tarball with an %s", async (label, mutate, message) => {
    const tar = gunzipSync(await readFile(goodTarball));
    const offset = tarHeaderOffsets(tar)[0];
    if (offset === undefined) {
      throw new Error("expected a tar header");
    }
    mutate(tar, offset);
    const invalid = join(fixtureRoot, `${label.replaceAll(" ", "-")}.tgz`);
    await writeFile(invalid, gzipSync(tar));

    await expect(inspectTarball(invalid)).rejects.toThrow(message);
  });

  it("rejects duplicate paths, a missing manifest, and invalid manifest JSON", async () => {
    const original = gunzipSync(await readFile(goodTarball));
    const offsets = tarHeaderOffsets(original);
    const first = offsets[0];
    const second = offsets[1];
    const packageJson = offsets.find(
      (offset) => tarEntryName(original, offset) === "package/package.json",
    );
    if (first === undefined || second === undefined || packageJson === undefined) {
      throw new Error("expected fixture tar headers");
    }

    const duplicate = Buffer.from(original);
    writeTarField(duplicate, second, 0, 100, tarEntryName(duplicate, first));
    refreshTarChecksum(duplicate, second);
    const duplicatePath = join(fixtureRoot, "duplicate-path.tgz");
    await writeFile(duplicatePath, gzipSync(duplicate));
    await expect(inspectTarball(duplicatePath)).rejects.toThrow("duplicate entry path");

    const missing = Buffer.from(original);
    writeTarField(missing, packageJson, 0, 100, "package/manifest.json");
    refreshTarChecksum(missing, packageJson);
    const missingPath = join(fixtureRoot, "missing-manifest.tgz");
    await writeFile(missingPath, gzipSync(missing));
    await expect(inspectTarball(missingPath)).rejects.toThrow(
      "does not contain package/package.json",
    );

    const invalidJson = Buffer.from(original);
    invalidJson[packageJson + 512] = 120;
    const invalidJsonPath = join(fixtureRoot, "invalid-manifest-json.tgz");
    await writeFile(invalidJsonPath, gzipSync(invalidJson));
    await expect(inspectTarball(invalidJsonPath)).rejects.toThrow(
      "package.json is not valid JSON",
    );
  });
});

describe("packDirectory", () => {
  it("surfaces npm pack failures and cleans its temporary destination", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "package-contract-invalid-pack-test-"),
    );
    try {
      await expect(packDirectory(directory)).rejects.toThrow("npm pack failed");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

describe("testPackage", () => {
  it("passes a healthy tarball in a clean ESM consumer", async () => {
    const report = await testPackage({ kind: "tarball", path: goodTarball });

    expect(report.results.filter(({ state }) => state === "pass")).toHaveLength(5);
    expect(
      report.results.filter(({ state }) => state === "not-evaluated"),
    ).toHaveLength(3);
    expect(report.diagnostics).toEqual([]);
    expect(report.lockfileSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.results).toContainEqual(
      expect.objectContaining({ state: "pass", subpath: "./index.js" }),
    );
  });

  it("accepts a profile returned by the public defineConsumer helper", async () => {
    const profile = defineConsumer({
      moduleSystem: "esm",
      runtime: { version: process.version },
      typescriptResolution: "nodenext",
    });
    const report = await testPackage(
      { kind: "tarball", path: goodTarball },
      { profiles: [profile] },
    );

    expect(report.diagnostics).toEqual([]);
    expect(report.results).toEqual([
      expect.objectContaining({
        profile: profile.id,
        state: "pass",
      }),
    ]);
  });

  it("reproduces a runtime failure deterministically", async () => {
    const first = await testPackage({ kind: "tarball", path: badTarball });
    const second = await testPackage({ kind: "tarball", path: badTarball });

    expect(first.results.some(({ state }) => state === "fail")).toBe(true);
    expect(first.diagnostics).toHaveLength(1);
    expect(first.diagnostics[0]).toMatchObject({
      code: "PC1001",
      reproducible: true,
      subpath: ".",
    });
    expect(first.diagnostics[0]?.evidence).toContain("<consumer>");
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("materializes an allowlisted runnable reproduction without host paths", async () => {
    const report = await testPackage({ kind: "tarball", path: badTarball });
    const diagnostic = report.diagnostics[0];
    if (diagnostic === undefined) {
      throw new Error("expected a residual diagnostic");
    }
    const root = await mkdtemp(join(tmpdir(), "package-contract-repro-test-"));
    try {
      const reproduction = await materializeReproduction({
        diagnosticId: diagnostic.id,
        outputRoot: root,
        report,
        tarballPath: badTarball,
      });

      expect(reproduction.files).toEqual([
        "README.md",
        "package-lock.json",
        "package.json",
        "package.tgz",
        "probe.mjs",
      ]);
      const manifest = await readFile(join(reproduction.path, "package.json"), "utf8");
      const lockfile = await readFile(
        join(reproduction.path, "package-lock.json"),
        "utf8",
      );
      expect(manifest).not.toContain(fixtureRoot);
      expect(lockfile).not.toContain(fixtureRoot);
      expect(lockfile).toContain('"file:./package.tgz"');
      await execFileAsync(
        "npm",
        ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
        { cwd: reproduction.path },
      );
      await expect(
        execFileAsync("npm", ["run", "reproduce"], {
          cwd: reproduction.path,
        }),
      ).rejects.toMatchObject({ code: 1 });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects invalid reproduction identity, artifacts, and overwrites", async () => {
    const report = await testPackage({ kind: "tarball", path: badTarball });
    const diagnostic = report.diagnostics[0];
    if (diagnostic === undefined) {
      throw new Error("expected a residual diagnostic");
    }
    const root = await mkdtemp(join(tmpdir(), "package-contract-repro-guard-test-"));
    try {
      await expect(
        materializeReproduction({
          diagnosticId: "0000000000000000",
          outputRoot: root,
          report,
          tarballPath: badTarball,
        }),
      ).rejects.toThrow("diagnostic ID is not present");
      await expect(
        materializeReproduction({
          diagnosticId: "../outside",
          outputRoot: root,
          report: {
            ...report,
            diagnostics: [{ ...diagnostic, id: "../outside" }],
          },
          tarballPath: badTarball,
        }),
      ).rejects.toThrow("diagnostic ID is not safe");
      await expect(
        materializeReproduction({
          diagnosticId: diagnostic.id,
          outputRoot: root,
          report,
          tarballPath: goodTarball,
        }),
      ).rejects.toThrow("tarball does not match");

      await materializeReproduction({
        diagnosticId: diagnostic.id,
        outputRoot: root,
        report,
        tarballPath: badTarball,
      });
      await expect(
        materializeReproduction({
          diagnosticId: diagnostic.id,
          outputRoot: root,
          report,
          tarballPath: badTarball,
        }),
      ).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("materializes a strict TypeScript reproduction", async () => {
    const report = await testPackage(
      { kind: "tarball", path: typeFailureTarball },
      {
        profiles: [
          {
            moduleSystem: "esm",
            runtime: { version: process.version },
            typescriptResolution: "node16",
          },
        ],
      },
    );
    const diagnostic = report.diagnostics.find(({ code }) => code === "PC1002");
    if (diagnostic === undefined) {
      throw new Error("expected a TypeScript diagnostic");
    }
    const root = await mkdtemp(join(tmpdir(), "package-contract-ts-repro-test-"));
    try {
      const reproduction = await materializeReproduction({
        diagnosticId: diagnostic.id,
        outputRoot: root,
        report,
        tarballPath: typeFailureTarball,
      });
      expect(reproduction.files).toEqual([
        "README.md",
        "package-lock.json",
        "package.json",
        "package.tgz",
        "probe.mts",
        "tsconfig.json",
      ]);
      expect(
        JSON.parse(await readFile(join(reproduction.path, "tsconfig.json"), "utf8")),
      ).toMatchObject({
        compilerOptions: {
          module: "Node16",
          moduleResolution: "Node16",
          strict: true,
        },
        files: ["./probe.mts"],
      });
      await execFileAsync(
        "npm",
        ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
        { cwd: reproduction.path },
      );
      await expect(
        execFileAsync("npm", ["run", "reproduce"], {
          cwd: reproduction.path,
        }),
      ).rejects.toMatchObject({ code: 1 });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("materializes the CommonJS TypeScript probe form", async () => {
    const report = await testPackage(
      { kind: "tarball", path: typeFailureTarball },
      {
        profiles: [
          {
            moduleSystem: "esm",
            runtime: { version: process.version },
            typescriptResolution: "node16",
          },
        ],
      },
    );
    const original = report.diagnostics.find(({ code }) => code === "PC1002");
    if (original === undefined) {
      throw new Error("expected a TypeScript diagnostic");
    }
    const diagnostic = createDiagnostic({
      ...original,
      profile: {
        ...original.profile,
        moduleSystem: "cjs",
      },
    });
    const cjsReport = {
      ...report,
      diagnostics: [diagnostic],
    };
    const root = await mkdtemp(join(tmpdir(), "package-contract-cjs-repro-test-"));
    try {
      const reproduction = await materializeReproduction({
        diagnosticId: diagnostic.id,
        outputRoot: root,
        report: cjsReport,
        tarballPath: typeFailureTarball,
      });
      expect(reproduction.files).toContain("probe.cts");
      expect(await readFile(join(reproduction.path, "probe.cts"), "utf8")).toContain(
        "import subject = require",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects host-specific values from a generated reproduction", async () => {
    const report = await testPackage({ kind: "tarball", path: badTarball });
    const diagnostic = report.diagnostics[0];
    if (diagnostic === undefined) {
      throw new Error("expected a runtime diagnostic");
    }
    const root = await mkdtemp(join(tmpdir(), "package-contract-host-repro-test-"));
    try {
      await expect(
        materializeReproduction({
          diagnosticId: diagnostic.id,
          outputRoot: root,
          report: {
            ...report,
            actions: [
              {
                arguments: [],
                exportName: process.cwd(),
                kind: "export",
                subpath: ".",
              },
            ],
          },
          tarballPath: badTarball,
        }),
      ).rejects.toThrow("contains a host-specific path");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("hides causally explained failures unless explicitly included", async () => {
    const profile = {
      moduleSystem: "esm" as const,
      runtime: { version: process.version },
    };
    const hidden = await testPackage(
      { kind: "tarball", path: explainedTarball },
      { profiles: [profile] },
    );
    const included = await testPackage(
      { kind: "tarball", path: explainedTarball },
      { includeExplained: true, profiles: [profile] },
    );

    expect(hidden.diagnostics).toEqual([]);
    expect(hidden.results[0]).toMatchObject({
      diagnostics: [
        {
          code: "PC1001",
          explainedBy: ["publint:FILE_DOES_NOT_EXIST"],
        },
      ],
      state: "fail",
    });
    expect(included.diagnostics).toHaveLength(1);
    expect(included.tools).toEqual({
      attw: "0.18.5",
      publint: "0.3.22",
    });
  });

  it("runs explicit export and function-call consumer actions", async () => {
    const report = await testPackage(
      { kind: "tarball", path: actionTarball },
      {
        actions: [
          { exportName: "value", kind: "export", subpath: "." },
          {
            arguments: [20, 22],
            exportName: "sum",
            kind: "call",
            subpath: ".",
          },
        ],
        profiles: [
          {
            moduleSystem: "esm",
            runtime: { version: process.version },
          },
        ],
      },
    );

    expect(report.diagnostics).toEqual([]);
    expect(report.results).toEqual([
      expect.objectContaining({ state: "pass", subpath: "." }),
    ]);
  });

  it.each([
    [
      "lazy dynamic import",
      { exportName: "load", kind: "call" as const, subpath: "." },
    ],
    [
      "exported asset",
      { exportName: "asset", kind: "read-file" as const, subpath: "." },
    ],
    [
      "missing named export",
      { exportName: "missing", kind: "export" as const, subpath: "." },
    ],
  ])("reproduces an explicit %s action failure", async (_label, action) => {
    const report = await testPackage(
      { kind: "tarball", path: actionTarball },
      {
        actions: [action],
        profiles: [
          {
            moduleSystem: "esm",
            runtime: { version: process.version },
          },
        ],
      },
    );

    expect(report.diagnostics).toEqual([
      expect.objectContaining({
        code: "PC1001",
        reproducible: true,
        subpath: ".",
      }),
    ]);
    if (_label === "lazy dynamic import") {
      const diagnostic = report.diagnostics[0];
      if (diagnostic === undefined) {
        throw new Error("expected an action diagnostic");
      }
      const root = await mkdtemp(join(tmpdir(), "package-contract-action-repro-test-"));
      try {
        const reproduction = await materializeReproduction({
          diagnosticId: diagnostic.id,
          outputRoot: root,
          report,
          tarballPath: actionTarball,
        });
        expect(await readFile(join(reproduction.path, "probe.mjs"), "utf8")).toContain(
          'subject["load"]',
        );
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    }
  });

  it("runs declared package executables only through explicit actions", async () => {
    const profile = {
      moduleSystem: "esm" as const,
      runtime: { version: process.version },
    };
    const passing = await testPackage(
      { kind: "tarball", path: binTarball },
      { bins: [{ name: "fixture-cli" }], profiles: [profile] },
    );
    expect(passing.diagnostics).toEqual([]);
    expect(passing.results).toContainEqual(
      expect.objectContaining({
        state: "pass",
        subpath: "./bin/fixture-cli",
      }),
    );

    const failing = await testPackage(
      { kind: "tarball", path: binTarball },
      {
        bins: [{ arguments: ["--fail"], name: "fixture-cli" }],
        profiles: [profile],
      },
    );
    expect(failing.diagnostics).toEqual([
      expect.objectContaining({
        code: "PC1004",
        reproducible: true,
        subpath: "./bin/fixture-cli",
      }),
    ]);
    const diagnostic = failing.diagnostics[0];
    if (diagnostic === undefined) {
      throw new Error("expected an executable diagnostic");
    }
    const root = await mkdtemp(join(tmpdir(), "package-contract-bin-repro-test-"));
    try {
      const reproduction = await materializeReproduction({
        diagnosticId: diagnostic.id,
        outputRoot: root,
        report: failing,
        tarballPath: binTarball,
      });
      expect(await readFile(join(reproduction.path, "probe.mjs"), "utf8")).toContain(
        '["--fail"]',
      );
      await execFileAsync(
        "npm",
        ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
        { cwd: reproduction.path },
      );
      await expect(
        execFileAsync("npm", ["run", "reproduce"], {
          cwd: reproduction.path,
        }),
      ).rejects.toMatchObject({ code: 1 });

      const missingRoot = await mkdtemp(
        join(tmpdir(), "package-contract-missing-bin-repro-test-"),
      );
      try {
        await expect(
          materializeReproduction({
            diagnosticId: diagnostic.id,
            outputRoot: missingRoot,
            report: { ...failing, bins: [] },
            tarballPath: binTarball,
          }),
        ).rejects.toThrow("executable action is missing");
      } finally {
        await rm(missingRoot, { force: true, recursive: true });
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("marks an undeclared executable action as inapplicable", async () => {
    const report = await testPackage(
      { kind: "tarball", path: goodTarball },
      {
        bins: [{ name: "missing-cli" }],
        profiles: [
          {
            moduleSystem: "esm",
            runtime: { version: process.version },
          },
        ],
      },
    );

    expect(report.results).toContainEqual(
      expect.objectContaining({
        reason: expect.objectContaining({ code: "inapplicable-profile" }),
        state: "not-evaluated",
        subpath: "./bin/missing-cli",
      }),
    );
  });

  it("packs and tests a package directory", async () => {
    const directory = join(fixtureRoot, "package-contract-good-fixture");
    const report = await testPackage({ kind: "directory", path: directory });

    expect(report.results.some(({ state }) => state === "pass")).toBe(true);
    expect(report.package.name).toBe("package-contract-good-fixture");
  });

  it("packs an explicit package directory nested inside a workspace", async () => {
    const workspace = join(fixtureRoot, "workspace-fixture");
    const packageDirectory = join(workspace, "packages", "library");
    await mkdir(packageDirectory, { recursive: true });
    await Promise.all([
      writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify(
          {
            name: "package-contract-workspace-root",
            private: true,
            workspaces: ["packages/*"],
          },
          null,
          2,
        )}\n`,
      ),
      writeFile(
        join(packageDirectory, "package.json"),
        `${JSON.stringify(
          {
            exports: "./index.js",
            files: ["index.js"],
            name: "package-contract-workspace-library",
            type: "module",
            version: "1.0.0",
          },
          null,
          2,
        )}\n`,
      ),
      writeFile(join(packageDirectory, "index.js"), "export const value = 42;\n"),
    ]);

    const report = await testPackage(
      { kind: "directory", path: packageDirectory },
      {
        profiles: [
          {
            moduleSystem: "esm",
            runtime: { version: process.version },
          },
        ],
      },
    );

    expect(report.package.name).toBe("package-contract-workspace-library");
    expect(report.diagnostics).toEqual([]);
    expect(report.results).toEqual([expect.objectContaining({ state: "pass" })]);
  });

  it("reports an isolated offline cache miss as not evaluated", async () => {
    const report = await testPackage(
      { kind: "tarball", path: dependencyTarball },
      { offline: true },
    );

    expect(report.results[0]).toMatchObject({
      reason: { code: "offline-cache-miss" },
      state: "not-evaluated",
    });
  });

  it("runs applicable CommonJS runtime and type profiles", async () => {
    const report = await testPackage(
      { kind: "tarball", path: dualTarball },
      {
        actions: [{ exportName: "value", kind: "export", subpath: "." }],
        profiles: [
          {
            moduleSystem: "cjs",
            runtime: { version: process.version },
          },
          {
            moduleSystem: "cjs",
            runtime: { version: process.version },
            typescriptResolution: "nodenext",
          },
        ],
      },
    );

    expect(report.results.map(({ state }) => state)).toEqual(["pass", "pass"]);
  });

  it("marks unavailable runtimes and compilers as not evaluated", async () => {
    const runtime = await testPackage(
      { kind: "tarball", path: goodTarball },
      {
        profiles: [
          {
            moduleSystem: "esm",
            runtime: {
              executable: join(fixtureRoot, "missing-node"),
              version: "24.16.0",
            },
          },
        ],
      },
    );
    expect(runtime.results[0]).toMatchObject({
      reason: { code: "runtime-unavailable" },
      state: "not-evaluated",
    });

    const compiler = await testPackage(
      { kind: "tarball", path: goodTarball },
      {
        invokingDirectory: fixtureRoot,
        profiles: [
          {
            moduleSystem: "esm",
            runtime: { version: process.version },
            typescriptResolution: "nodenext",
          },
        ],
      },
    );
    expect(compiler.results[0]).toMatchObject({
      reason: { code: "compiler-unavailable" },
      state: "not-evaluated",
    });
    expect(compiler.environment.typescript).toBeNull();
  });

  it("rejects invalid orchestration limits and an empty profile matrix", async () => {
    await expect(
      testPackage({ kind: "tarball", path: goodTarball }, { concurrency: 0 }),
    ).rejects.toThrow("concurrency must be an integer from 1 to 16");
    await expect(
      testPackage({ kind: "tarball", path: goodTarball }, { concurrency: 17 }),
    ).rejects.toThrow("concurrency must be an integer from 1 to 16");
    await expect(
      testPackage({ kind: "tarball", path: goodTarball }, { concurrency: 1.5 }),
    ).rejects.toThrow("concurrency must be an integer from 1 to 16");
    await expect(
      testPackage({ kind: "tarball", path: goodTarball }, { profiles: [] }),
    ).rejects.toThrow("at least one consumer profile is required");
  });

  it("rejects a runtime executable whose detected version does not match", async () => {
    const report = await testPackage(
      { kind: "tarball", path: goodTarball },
      {
        profiles: [
          {
            moduleSystem: "esm",
            runtime: {
              executable: process.execPath,
              version: "99.0.0",
            },
          },
        ],
      },
    );

    expect(report.results).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({
          code: "runtime-unavailable",
          message: expect.stringContaining("not 99.0.0"),
        }),
        state: "not-evaluated",
      }),
    ]);
  });

  it("reports unsafe wildcard exports as explicitly not evaluated", async () => {
    const report = await testPackage({
      kind: "tarball",
      path: unsafePatternTarball,
    });

    expect(report.results).toContainEqual(
      expect.objectContaining({
        reason: expect.objectContaining({
          code: "unsupported-export-pattern",
        }),
        state: "not-evaluated",
        subpath: "./features/*",
      }),
    );
  });

  it("returns a stable installation diagnostic for an unusable local dependency", async () => {
    const report = await testPackage(
      { kind: "tarball", path: installationFailureTarball },
      {
        profiles: [
          {
            moduleSystem: "esm",
            runtime: { version: process.version },
          },
        ],
      },
    );

    expect(report.results).toEqual([
      expect.objectContaining({
        diagnostics: [
          expect.objectContaining({
            code: "PC1000",
            reproducible: false,
          }),
        ],
        state: "fail",
        subpath: ".",
      }),
    ]);
    expect(JSON.stringify(report)).not.toContain(fixtureRoot);

    const diagnostic = report.diagnostics[0];
    if (diagnostic === undefined) {
      throw new Error("expected an installation diagnostic");
    }
    const root = await mkdtemp(join(tmpdir(), "package-contract-install-repro-test-"));
    try {
      const reproduction = await materializeReproduction({
        diagnosticId: diagnostic.id,
        outputRoot: root,
        report,
        tarballPath: installationFailureTarball,
      });
      await expect(
        execFileAsync("npm", ["run", "reproduce"], {
          cwd: reproduction.path,
        }),
      ).rejects.toMatchObject({ code: 1 });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("records installation failure for every requested profile and subpath", async () => {
    const report = await testPackage(
      { kind: "tarball", path: installationFailureTarball },
      {
        bins: [{ name: "contract-fixture" }],
        profiles: [
          {
            moduleSystem: "esm",
            runtime: { version: process.version },
            subpaths: [".", "./feature"],
          },
          {
            moduleSystem: "cjs",
            runtime: { version: process.version },
          },
        ],
      },
    );

    expect(report.results).toHaveLength(5);
    expect(
      report.results.map(({ profile, state, subpath }) => ({
        moduleSystem: profile.moduleSystem,
        state,
        subpath,
      })),
    ).toEqual([
      { moduleSystem: "cjs", state: "fail", subpath: "." },
      { moduleSystem: "esm", state: "fail", subpath: "." },
      { moduleSystem: "cjs", state: "fail", subpath: "./bin/contract-fixture" },
      { moduleSystem: "esm", state: "fail", subpath: "./bin/contract-fixture" },
      { moduleSystem: "esm", state: "fail", subpath: "./feature" },
    ]);
    expect(report.diagnostics.every(({ code }) => code === "PC1000")).toBe(true);
  });

  it("expands safe wildcard exports and skips unclaimed types", async () => {
    const pattern = await testPackage({
      kind: "tarball",
      path: patternTarball,
    });
    expect(pattern.results).toContainEqual(
      expect.objectContaining({
        state: "pass",
        subpath: "./features/a",
      }),
    );

    const untyped = await testPackage({
      kind: "tarball",
      path: untypedTarball,
    });
    expect(
      untyped.results
        .filter(({ profile }) => profile.typescriptResolution !== null)
        .every(({ state }) => state === "not-evaluated"),
    ).toBe(true);
  });

  it("limits explicit profiles to their requested subpaths", async () => {
    const report = await testPackage(
      { kind: "tarball", path: patternTarball },
      {
        profiles: [
          {
            moduleSystem: "esm",
            runtime: { version: process.version },
            subpaths: ["./features/a"],
          },
        ],
      },
    );

    expect(report.results).toEqual([
      expect.objectContaining({
        state: "pass",
        subpath: "./features/a",
      }),
    ]);
  });

  it("replays an installed dependency graph from its lockfile and warm cache", async () => {
    const artifact = await inspectTarball(dependencyTarball);
    const cache = await createTemporaryDirectory("package-contract-cache-test-");
    try {
      const first = await runRootEsmConsumer(artifact, { cachePath: cache.path });
      try {
        expect(first.install.exitCode).toBe(0);
        expect(first.probe?.exitCode).toBe(0);
        expect(first.lockfile).not.toBeNull();
        if (first.lockfile === null) {
          throw new Error("expected npm to create a lockfile");
        }

        const replay = await runRootEsmConsumer(artifact, {
          cachePath: cache.path,
          lockfile: first.lockfile,
          offline: true,
        });
        try {
          expect(replay.install.exitCode).toBe(0);
          expect(replay.probe?.exitCode).toBe(0);
          expect(replay.lockfile).toBe(first.lockfile);
        } finally {
          await replay.cleanup();
        }
      } finally {
        await first.cleanup();
      }
    } finally {
      await Promise.all([artifact.cleanup(), cache.cleanup()]);
    }
  });

  it("isolates concurrent installs while safely sharing one npm cache", async () => {
    const artifact = await inspectTarball(dependencyTarball);
    const cache = await createTemporaryDirectory(
      "package-contract-cache-contention-test-",
    );
    const installs = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        installConsumer(artifact, { cachePath: cache.path }),
      ),
    );
    const consumers = installs.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    try {
      expect(installs.every(({ status }) => status === "fulfilled")).toBe(true);
      expect(consumers.map(({ install }) => install.exitCode)).toEqual([0, 0, 0, 0]);
      expect(new Set(consumers.map(({ path }) => path)).size).toBe(4);
    } finally {
      const paths = consumers.map(({ path }) => path);
      await Promise.all(consumers.map(({ cleanup }) => cleanup()));
      await Promise.all([artifact.cleanup(), cache.cleanup()]);
      for (const path of paths) {
        await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
      }
    }
  });
});

describe("comparePackages", () => {
  it("classifies a controlled runtime regression under one dependency graph", async () => {
    const comparison = await comparePackages(
      { kind: "tarball", path: comparisonBeforeTarball },
      { kind: "tarball", path: comparisonAfterTarball },
      {
        profiles: [
          {
            moduleSystem: "esm",
            runtime: { version: process.version },
          },
        ],
      },
    );

    expect(comparison).toMatchObject({
      conclusive: true,
      fixes: [],
      inconclusiveReason: null,
      regressions: [{ code: "PC1001", subpath: "." }],
      unchanged: [],
    });
  });

  it("classifies fixes and unchanged diagnostics by stable identity", async () => {
    const options = {
      profiles: [
        {
          moduleSystem: "esm" as const,
          runtime: { version: process.version },
        },
      ],
    };
    const fixed = await comparePackages(
      { kind: "tarball", path: comparisonAfterTarball },
      { kind: "tarball", path: comparisonBeforeTarball },
      options,
    );
    expect(fixed).toMatchObject({
      conclusive: true,
      fixes: [{ code: "PC1001" }],
      regressions: [],
      unchanged: [],
    });

    const unchanged = await comparePackages(
      { kind: "tarball", path: comparisonAfterTarball },
      { kind: "tarball", path: comparisonAfterTarball },
      options,
    );
    expect(unchanged).toMatchObject({
      conclusive: true,
      fixes: [],
      regressions: [],
      unchanged: [{ before: { code: "PC1001" }, after: { code: "PC1001" } }],
    });
  });

  it("marks changed transitive installation state as inconclusive", async () => {
    const comparison = await comparePackages(
      { kind: "tarball", path: comparisonDriftBeforeTarball },
      { kind: "tarball", path: comparisonDriftTarball },
      {
        profiles: [
          {
            moduleSystem: "esm",
            runtime: { version: process.version },
          },
        ],
      },
    );

    expect(comparison).toMatchObject({
      conclusive: false,
      inconclusiveReason: "dependency-graph-drift",
      regressions: [],
    });
  });

  it("does not consult the registry for a new after dependency", async () => {
    const comparison = await comparePackages(
      { kind: "tarball", path: comparisonBeforeTarball },
      { kind: "tarball", path: comparisonDriftTarball },
      {
        profiles: [
          {
            moduleSystem: "esm",
            runtime: { version: process.version },
          },
        ],
      },
    );

    expect(comparison).toMatchObject({
      conclusive: false,
      inconclusiveReason: "dependency-graph-unavailable",
      regressions: [],
    });
  });

  it("marks changed profile evaluation coverage as inconclusive", async () => {
    const comparison = await comparePackages(
      { kind: "tarball", path: comparisonAfterTarball },
      { kind: "tarball", path: comparisonCoverageDriftTarball },
      {
        profiles: [
          {
            moduleSystem: "esm",
            runtime: { version: process.version },
          },
        ],
      },
    );

    expect(comparison).toMatchObject({
      conclusive: false,
      fixes: [{ code: "PC1001" }],
      inconclusiveReason: "evaluation-coverage-drift",
      regressions: [],
    });
    expect(comparison.beforeResults).toEqual([
      expect.objectContaining({ state: "fail" }),
    ]);
    expect(comparison.afterResults).toEqual([
      expect.objectContaining({ state: "not-evaluated" }),
    ]);
  });
});
