import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { testPackage } from "../src/index.js";

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
          engines: { node: ">=18" },
          exports: "./index.js",
          files: ["index.js"],
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
    const pack = join(root, "pack");
    await mkdir(pack);
    const { stdout } = await execFileAsync(
      "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", pack],
      { cwd: root },
    );
    const [{ filename }] = JSON.parse(stdout) as [{ filename: string }];
    tarball = join(pack, filename);
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
    ]);

    const currentRuntime = await testPackage(
      { kind: "tarball", path: tarball },
      {
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
    ]);
  });
});
