import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runRootEsmConsumer } from "../src/core/consumer.js";
import { inspectTarball } from "../src/core/tarball.js";
import { createTemporaryDirectory } from "../src/core/temporary.js";
import { defineConsumer, testPackage } from "../src/index.js";
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
let untypedTarball = "";

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
});

describe("testPackage", () => {
  it("passes a healthy tarball in a clean ESM consumer", async () => {
    const report = await testPackage({ kind: "tarball", path: goodTarball });

    expect(report.results.filter(({ state }) => state === "pass")).toHaveLength(4);
    expect(
      report.results.filter(({ state }) => state === "not-evaluated"),
    ).toHaveLength(3);
    expect(report.diagnostics).toEqual([]);
    expect(report.lockfileSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("reproduces a runtime failure deterministically", async () => {
    const first = await testPackage({ kind: "tarball", path: badTarball });
    const second = await testPackage({ kind: "tarball", path: badTarball });

    expect(first.results.some(({ state }) => state === "fail")).toBe(true);
    expect(first.diagnostics).toHaveLength(1);
    expect(first.diagnostics[0]).toMatchObject({
      code: "PC1001",
      reproducible: false,
      subpath: ".",
    });
    expect(first.diagnostics[0]?.evidence).toContain("<consumer>");
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("packs and tests a package directory", async () => {
    const directory = join(fixtureRoot, "package-contract-good-fixture");
    const report = await testPackage({ kind: "directory", path: directory });

    expect(report.results.some(({ state }) => state === "pass")).toBe(true);
    expect(report.package.name).toBe("package-contract-good-fixture");
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
});
