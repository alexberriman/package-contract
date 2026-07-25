import { readFile, realpath, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { createSafeEnvironment } from "./environment.js";
import { hashFile } from "./hash.js";
import { compareCodeUnits } from "./order.js";
import { runProcess } from "./process.js";
import { createTemporaryDirectory } from "./temporary.js";

export interface PackedFile {
  readonly mode: number;
  readonly path: string;
  readonly size: number;
}

export interface PackArtifact {
  readonly cleanup: () => Promise<void>;
  readonly files: readonly PackedFile[];
  readonly integrity: string;
  readonly name: string;
  readonly path: string;
  readonly sha256: string;
  readonly version: string;
}

interface NpmPackResult {
  readonly filename: string;
  readonly files: readonly PackedFile[];
  readonly integrity: string;
  readonly name: string;
  readonly version: string;
}

function parsePackResult(stdout: string): NpmPackResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("npm pack did not return valid JSON");
  }
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error("npm pack returned an unexpected result count");
  }
  const result = parsed[0] as Partial<NpmPackResult>;
  if (
    typeof result.filename !== "string" ||
    typeof result.integrity !== "string" ||
    typeof result.name !== "string" ||
    typeof result.version !== "string" ||
    !Array.isArray(result.files)
  ) {
    throw new Error("npm pack returned an invalid result");
  }
  return result as NpmPackResult;
}

export async function packDirectory(directory: string): Promise<PackArtifact> {
  const temporary = await createTemporaryDirectory("package-contract-pack-");
  const npmConfig = join(temporary.path, "npmrc");
  const globalNpmConfig = join(temporary.path, "global-npmrc");
  await writeFile(npmConfig, "audit=false\nfund=false\nupdate-notifier=false\n", {
    mode: 0o600,
  });
  await writeFile(globalNpmConfig, "", { mode: 0o600 });

  try {
    const result = await runProcess({
      args: [
        "pack",
        "--json",
        "--pack-destination",
        temporary.path,
        "--userconfig",
        npmConfig,
        "--globalconfig",
        globalNpmConfig,
      ],
      cwd: directory,
      env: createSafeEnvironment(),
      executable: "npm",
    });
    if (result.timedOut) {
      throw new Error("npm pack timed out");
    }
    if (result.truncated) {
      throw new Error("npm pack exceeded the output limit");
    }
    if (result.exitCode !== 0) {
      throw new Error(`npm pack failed with exit code ${result.exitCode}`);
    }

    const packed = parsePackResult(result.stdout);
    if (basename(packed.filename) !== packed.filename) {
      throw new Error("npm pack returned an unsafe filename");
    }
    const path = await realpath(join(temporary.path, packed.filename));
    const packageJson = JSON.parse(
      await readFile(join(directory, "package.json"), "utf8"),
    ) as { name?: unknown };
    if (packageJson.name !== packed.name) {
      throw new Error("packed package name does not match the source manifest");
    }

    return Object.freeze({
      cleanup: temporary.cleanup,
      files: Object.freeze(
        packed.files
          .map((file) => Object.freeze({ ...file }))
          .sort((left, right) => compareCodeUnits(left.path, right.path)),
      ),
      integrity: packed.integrity,
      name: packed.name,
      path,
      sha256: await hashFile(path),
      version: packed.version,
    });
  } catch (error) {
    await temporary.cleanup();
    throw error;
  }
}
