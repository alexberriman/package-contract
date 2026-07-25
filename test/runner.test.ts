import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inspectTarball } from "../src/core/tarball.js";
import { testPackage } from "../src/index.js";

const execFileAsync = promisify(execFile);
let fixtureRoot = "";
let goodTarball = "";
let badTarball = "";
let dependencyTarball = "";

async function makeFixture(
  name: string,
  source: string,
  extraFiles: Record<string, string> = {},
  dependencies: Record<string, string> = {},
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
    await writeFile(join(directory, path), contents);
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

    expect(report.results).toEqual([{ diagnostics: [], state: "pass" }]);
    expect(report.diagnostics).toEqual([]);
    expect(report.lockfileSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("reproduces a runtime failure deterministically", async () => {
    const first = await testPackage({ kind: "tarball", path: badTarball });
    const second = await testPackage({ kind: "tarball", path: badTarball });

    expect(first.results[0]?.state).toBe("fail");
    expect(first.diagnostics).toHaveLength(1);
    expect(first.diagnostics[0]).toMatchObject({
      code: "PC1001",
      reproducible: true,
      subpath: ".",
    });
    expect(first.diagnostics[0]?.evidence).toContain("<consumer>");
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("packs and tests a package directory", async () => {
    const directory = join(fixtureRoot, "package-contract-good-fixture");
    const report = await testPackage({ kind: "directory", path: directory });

    expect(report.results[0]?.state).toBe("pass");
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
});
