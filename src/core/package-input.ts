import { realpath, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";

import type { PackageInput } from "./input.js";

export interface ResolvedPackageInput {
  readonly kind: PackageInput["kind"];
  readonly path: string;
}

export async function resolvePackageInput(
  input: PackageInput,
): Promise<ResolvedPackageInput> {
  if (input.path.includes("\u0000")) {
    throw new TypeError("package path must not contain a NUL byte");
  }

  const canonical = await realpath(resolve(input.path));
  const metadata = await stat(canonical);
  if (input.kind === "directory" && !metadata.isDirectory()) {
    throw new TypeError("directory package input must resolve to a directory");
  }
  if (input.kind === "tarball") {
    if (!metadata.isFile()) {
      throw new TypeError("tarball package input must resolve to a regular file");
    }
    if (extname(canonical) !== ".tgz") {
      throw new TypeError("tarball package input must use the .tgz extension");
    }
  }

  return Object.freeze({ kind: input.kind, path: canonical });
}
