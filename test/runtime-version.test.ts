import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { materializeReproduction } from "../src/core/reproduction.js";
import { testPackage } from "../src/index.js";
import { npmPackFilename } from "./helpers/npm.js";

const execFileAsync = promisify(execFile);
const node18 = process.env.PACKAGE_CONTRACT_NODE18;
let root = "";
let tarball = "";

describe.skipIf(node18 === undefined)("Node 18 runtime boundary", () => {
  beforeAll(async () => {
    if (node18 === undefined) {
      throw new Error("Node 18 executable is required");
    }
    root = await mkdtemp(join(tmpdir(), "package-contract-node18-test-"));
    await writeFile(
      join(root, "package.json"),
      `${JSON.stringify(
        {
          bin: { "node-floor": "./cli.js" },
          engines: { node: ">=18" },
          exports: "./index.js",
          files: ["index.js", "cli.js"],
          name: "package-contract-node18-fixture",
          type: "module",
          version: "1.0.0",
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      join(root, "index.js"),
      "import { globSync } from 'node:fs';\nexport const value = globSync;\n",
    );
    await writeFile(
      join(root, "cli.js"),
      "#!/usr/bin/env node\nimport { globSync } from 'node:fs';\nglobSync('*');\n",
    );
    const pack = join(root, "pack");
    await mkdir(pack);
    const { stdout } = await execFileAsync(
      "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", pack],
      { cwd: root },
    );
    tarball = join(pack, npmPackFilename(stdout));
  });

  afterAll(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it("fails on the claimed Node 18 floor and passes on the supported runner", async () => {
    if (node18 === undefined) {
      throw new Error("Node 18 executable is required");
    }
    const oldRuntime = await testPackage(
      { kind: "tarball", path: tarball },
      {
        bins: [{ name: "node-floor" }],
        profiles: [
          {
            moduleSystem: "esm",
            runtime: {
              executable: node18,
              version: "18.20.8",
            },
          },
        ],
      },
    );
    expect(oldRuntime.diagnostics).toEqual([
      expect.objectContaining({
        code: "PC1001",
        explainedBy: null,
      }),
      expect.objectContaining({
        code: "PC1004",
        explainedBy: null,
        subpath: "./bin/node-floor",
      }),
    ]);
    for (const diagnostic of oldRuntime.diagnostics) {
      const reproduction = await materializeReproduction({
        diagnosticId: diagnostic.id,
        outputRoot: join(root, "repros"),
        report: oldRuntime,
        tarballPath: tarball,
      });
      await execFileAsync(
        "npm",
        ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
        { cwd: reproduction.path },
      );
      const entry = reproduction.files.find((file) => file.startsWith("probe"));
      if (entry === undefined) {
        throw new Error("expected a reproduction entrypoint");
      }
      await expect(
        execFileAsync(node18, [entry], { cwd: reproduction.path }),
      ).rejects.toMatchObject({ code: 1 });
      await expect(
        execFileAsync(process.execPath, [entry], { cwd: reproduction.path }),
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("requires Node 18.20.8"),
      });
    }

    const currentRuntime = await testPackage(
      { kind: "tarball", path: tarball },
      {
        bins: [{ name: "node-floor" }],
        profiles: [
          {
            moduleSystem: "esm",
            runtime: { version: process.version },
          },
        ],
      },
    );
    expect(currentRuntime.diagnostics).toEqual([]);
    expect(currentRuntime.results).toEqual([
      expect.objectContaining({ state: "pass" }),
      expect.objectContaining({
        state: "pass",
        subpath: "./bin/node-floor",
      }),
    ]);
  });
});
