import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const cli = join(root, "dist", "cli.js");
let fixtureRoot: string;
let healthyTarball: string;
let brokenTarball: string;
let explainedTarball: string;

async function packFixture(
  name: string,
  source: string,
  manifestOverrides: Record<string, unknown> = {},
): Promise<string> {
  const directory = join(fixtureRoot, name);
  const destination = join(directory, "pack");
  await mkdir(destination, { recursive: true });
  await Promise.all([
    writeFile(
      join(directory, "package.json"),
      `${JSON.stringify(
        {
          exports: {
            ".": {
              import: "./index.js",
              types: "./index.d.ts",
            },
          },
          files: ["index.js", "index.d.ts"],
          name,
          type: "module",
          version: "1.0.0",
          ...manifestOverrides,
        },
        null,
        2,
      )}\n`,
    ),
    writeFile(join(directory, "index.js"), source),
    writeFile(join(directory, "index.d.ts"), "export declare const value: number;\n"),
  ]);
  const { stdout } = await execFileAsync(
    "npm",
    ["pack", "--json", "--pack-destination", destination],
    { cwd: directory },
  );
  const [result] = JSON.parse(stdout) as [{ filename: string }];
  return join(destination, basename(result.filename));
}

async function runCli(
  arguments_: readonly string[],
  cwd: string = root,
): Promise<{ code: number; stderr: string; stdout: string }> {
  try {
    const result = await execFileAsync(process.execPath, [cli, ...arguments_], {
      cwd,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { code: 0, stderr: result.stderr, stdout: result.stdout };
  } catch (error) {
    const failure = error as {
      code: number;
      stderr: string;
      stdout: string;
    };
    return {
      code: failure.code,
      stderr: failure.stderr,
      stdout: failure.stdout,
    };
  }
}

beforeAll(async () => {
  await execFileAsync("npm", ["run", "build"], { cwd: root });
  fixtureRoot = await mkdtemp(join(tmpdir(), "package-contract-cli-test-"));
  healthyTarball = await packFixture(
    "package-contract-cli-healthy-fixture",
    "export const value = 42;\n",
  );
  brokenTarball = await packFixture(
    "package-contract-cli-broken-fixture",
    "import 'package-contract-definitely-missing';\nexport const value = 42;\n",
    { name: "package-contract-cli-healthy-fixture" },
  );
  explainedTarball = await packFixture(
    "package-contract-cli-explained-fixture",
    "export const value = 42;\n",
    {
      exports: {
        ".": {
          import: "./missing.js",
          types: "./index.d.ts",
        },
      },
    },
  );
});

afterAll(async () => {
  await rm(fixtureRoot, { force: true, recursive: true });
});

describe("installed CLI boundary", () => {
  it("reports the installed manifest version and help", async () => {
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
      version: string;
    };
    const version = await runCli(["--version"]);
    const help = await runCli(["--help"]);

    expect(version).toEqual({
      code: 0,
      stderr: "",
      stdout: `${manifest.version}\n`,
    });
    expect(help).toMatchObject({
      code: 0,
      stderr: "",
    });
    expect(help.stdout).toContain("package-contract check");
  });

  it("checks a packed artifact and emits parseable JSON", async () => {
    const result = await runCli(["check", healthyTarball, "--json"]);
    const report = JSON.parse(result.stdout) as {
      diagnostics: unknown[];
      package: { name: string };
    };

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(report.diagnostics).toEqual([]);
    expect(report.package.name).toBe("package-contract-cli-healthy-fixture");
  });

  it("returns documented exit codes for residual failures and usage errors", async () => {
    const failed = await runCli(["check", brokenTarball, "--json"]);
    const invalid = await runCli(["check", healthyTarball, "--reporter", "future"]);

    expect(failed.code).toBe(1);
    expect(JSON.parse(failed.stdout)).toMatchObject({
      diagnostics: [expect.objectContaining({ code: "PC1001" })],
    });
    expect(invalid).toMatchObject({
      code: 2,
      stdout: "",
    });
    expect(invalid.stderr).toContain(
      "package-contract: reporter must be human, json, or github",
    );
  });

  it("supports human, GitHub, offline, and explained-report modes", async () => {
    const human = await runCli(["check", brokenTarball]);
    const github = await runCli(["check", brokenTarball, "--reporter", "github"]);
    const offline = await runCli(["check", healthyTarball, "--offline"]);
    const hidden = await runCli(["check", explainedTarball, "--json"]);
    const included = await runCli([
      "check",
      explainedTarball,
      "--json",
      "--include-explained",
    ]);

    expect(human).toMatchObject({ code: 1, stderr: "" });
    expect(human.stdout).toContain("PC1001 Package evaluation failed");
    expect(github).toMatchObject({ code: 1, stderr: "" });
    expect(github.stdout).toMatch(/^::error title=PC1001 /);
    expect(offline).toEqual({ code: 0, stderr: "", stdout: "" });
    expect(hidden.code).toBe(0);
    expect(JSON.parse(hidden.stdout).diagnostics).toEqual([]);
    expect(included.code).toBe(0);
    expect(JSON.parse(included.stdout).diagnostics).toEqual([
      expect.objectContaining({
        code: "PC1001",
        explainedBy: ["publint:FILE_DOES_NOT_EXIST"],
      }),
    ]);
  });

  it("compares packed artifacts and rejects incompatible output options", async () => {
    const unchanged = await runCli([
      "compare",
      healthyTarball,
      healthyTarball,
      "--json",
    ]);
    const regression = await runCli([
      "compare",
      healthyTarball,
      brokenTarball,
      "--json",
    ]);
    const invalid = await runCli([
      "check",
      healthyTarball,
      "--json",
      "--reporter",
      "human",
    ]);

    expect(unchanged.code).toBe(0);
    expect(JSON.parse(unchanged.stdout)).toMatchObject({
      conclusive: true,
      regressions: [],
    });
    expect(regression.code).toBe(1);
    expect(JSON.parse(regression.stdout)).toMatchObject({
      conclusive: true,
      regressions: [expect.objectContaining({ code: "PC1001" })],
    });
    expect(invalid.code).toBe(2);
    expect(invalid.stderr).toContain(
      "--json cannot be combined with a non-JSON reporter",
    );
  });

  it("materializes a requested reproduction from the CLI", async () => {
    const checked = await runCli(["check", brokenTarball, "--json"]);
    const report = JSON.parse(checked.stdout) as {
      diagnostics: [{ id: string }];
    };
    const diagnostic = report.diagnostics[0];
    if (diagnostic === undefined) {
      throw new Error("expected a CLI diagnostic");
    }
    const consumer = await mkdtemp(join(tmpdir(), "package-contract-cli-repro-test-"));
    try {
      const result = await runCli(
        ["check", brokenTarball, "--repro", diagnostic.id],
        consumer,
      );

      expect(result.code).toBe(1);
      expect(result.stderr).toContain(
        `Reproduction written to repros/${diagnostic.id}`,
      );
      expect(
        await readFile(join(consumer, "repros", diagnostic.id, "package.json"), "utf8"),
      ).toContain("package-contract-cli-healthy-fixture");
    } finally {
      await rm(consumer, { force: true, recursive: true });
    }
  });
});
