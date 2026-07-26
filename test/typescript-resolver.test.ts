import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveTypeScriptCompiler } from "../src/probes/typescript-resolver.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "package-contract-resolver-"));
  temporaryDirectories.push(path);
  return path;
}

async function fakeTypeScript(
  manifest: unknown,
  files: Readonly<Record<string, string>> = {},
): Promise<string> {
  const root = await temporaryDirectory();
  const packagePath = join(root, "typescript");
  await mkdir(packagePath);
  await writeFile(join(packagePath, "package.json"), JSON.stringify(manifest));
  for (const [path, contents] of Object.entries(files)) {
    await writeFile(join(packagePath, path), contents);
  }
  return packagePath;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("TypeScript compiler resolution boundaries", () => {
  it("returns null when upward discovery reaches the filesystem root", async () => {
    const directory = await temporaryDirectory();
    await expect(
      resolveTypeScriptCompiler({ invokingDirectory: directory }),
    ).resolves.toBeNull();
  });

  it("rejects unreadable and malformed manifests", async () => {
    const directory = await temporaryDirectory();
    await expect(
      resolveTypeScriptCompiler({
        invokingDirectory: directory,
        typescriptPath: directory,
      }),
    ).resolves.toBeNull();

    const packagePath = await fakeTypeScript(null);
    await writeFile(join(packagePath, "package.json"), "{");
    await expect(
      resolveTypeScriptCompiler({
        invokingDirectory: packagePath,
        typescriptPath: packagePath,
      }),
    ).resolves.toBeNull();
  });

  it.each([
    [{ name: "not-typescript", version: "6.0.0" }, "wrong package"],
    [{ name: "typescript" }, "missing version"],
    [{ name: "typescript", version: "next" }, "invalid version"],
    [{ name: "typescript", version: "5.5.9" }, "too old"],
    [{ name: "typescript", version: "7.0.1" }, "unvalidated native patch"],
    [{ name: "typescript", version: "7.1.0" }, "unvalidated native minor"],
    [{ name: "typescript", version: "8.0.0" }, "too new"],
  ])("rejects an unsupported manifest: %s", async (manifest, _label) => {
    const packagePath = await fakeTypeScript(manifest);
    await expect(
      resolveTypeScriptCompiler({
        invokingDirectory: packagePath,
        typescriptPath: packagePath,
      }),
    ).resolves.toBeNull();
  });

  it("accepts a classic compiler selected by its package.json path", async () => {
    const packagePath = await fakeTypeScript(
      { main: "./lib.js", name: "typescript", version: "6.0.0-beta.1" },
      { "lib.js": "module.exports = {};\n" },
    );
    const canonicalPackagePath = await realpath(packagePath);
    await expect(
      resolveTypeScriptCompiler({
        invokingDirectory: packagePath,
        typescriptPath: join(packagePath, "package.json"),
      }),
    ).resolves.toMatchObject({
      kind: "classic",
      packagePath: canonicalPackagePath,
      version: "6.0.0-beta.1",
    });
  });

  it.each([
    [{ name: "typescript", version: "6.0.0" }, "missing main"],
    [{ main: "lib.js", name: "typescript", version: "6.0.0" }, "non-relative main"],
    [{ main: "./missing.js", name: "typescript", version: "6.0.0" }, "missing entry"],
  ])("rejects an invalid classic compiler: %s", async (manifest, _label) => {
    const packagePath = await fakeTypeScript(manifest);
    await expect(
      resolveTypeScriptCompiler({
        invokingDirectory: packagePath,
        typescriptPath: packagePath,
      }),
    ).resolves.toBeNull();
  });

  it("rejects classic entry points that escape the package", async () => {
    const root = await temporaryDirectory();
    const packagePath = join(root, "typescript");
    await mkdir(packagePath);
    await writeFile(
      join(packagePath, "package.json"),
      JSON.stringify({
        main: "./../outside.js",
        name: "typescript",
        version: "6.0.0",
      }),
    );
    await writeFile(join(root, "outside.js"), "module.exports = {};\n");

    await expect(
      resolveTypeScriptCompiler({
        invokingDirectory: packagePath,
        typescriptPath: packagePath,
      }),
    ).resolves.toBeNull();
  });

  it("rejects a native compiler without its unstable sync API", async () => {
    const packagePath = await fakeTypeScript({
      name: "typescript",
      version: "7.0.0",
    });
    await expect(
      resolveTypeScriptCompiler({
        invokingDirectory: packagePath,
        typescriptPath: packagePath,
      }),
    ).resolves.toBeNull();
  });
});
