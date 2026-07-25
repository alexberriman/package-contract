import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

import { hashFile } from "./hash.js";
import type { PackArtifact, PackedFile } from "./pack.js";

const TAR_BLOCK_SIZE = 512;
const MAX_TARBALL_BYTES = 100 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 500 * 1024 * 1024;
const MAX_PACKAGE_JSON_BYTES = 1024 * 1024;
const MAX_PACKED_FILES = 100_000;

function readString(block: Buffer, start: number, length: number): string {
  const end = block.indexOf(0, start);
  const boundedEnd = end === -1 || end > start + length ? start + length : end;
  return block.subarray(start, boundedEnd).toString("utf8");
}

function readOctal(block: Buffer, start: number, length: number): number {
  const value = readString(block, start, length).trim();
  if (!/^[0-7]+$/.test(value)) {
    throw new Error("tarball contains an invalid numeric header");
  }
  return Number.parseInt(value, 8);
}

function validateEntryPath(path: string): void {
  if (
    !path.startsWith("package/") ||
    path.includes("\u0000") ||
    path.split("/").includes("..")
  ) {
    throw new Error("tarball contains an unsafe entry path");
  }
}

interface TarContents {
  readonly files: readonly PackedFile[];
  readonly packageJson: Buffer;
}

function inspectTar(buffer: Buffer): TarContents {
  const files: PackedFile[] = [];
  let packageJson: Buffer | undefined;
  let offset = 0;

  while (offset + TAR_BLOCK_SIZE <= buffer.byteLength) {
    const header = buffer.subarray(offset, offset + TAR_BLOCK_SIZE);
    if (header.every((byte) => byte === 0)) {
      break;
    }

    const name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const path = prefix.length > 0 ? `${prefix}/${name}` : name;
    validateEntryPath(path);
    const mode = readOctal(header, 100, 8);
    const size = readOctal(header, 124, 12);
    const type = readString(header, 156, 1);
    const contentsStart = offset + TAR_BLOCK_SIZE;
    const contentsEnd = contentsStart + size;
    if (contentsEnd > buffer.byteLength) {
      throw new Error("tarball entry extends beyond the archive");
    }

    if (type === "" || type === "0") {
      files.push(
        Object.freeze({
          mode,
          path: path.slice("package/".length),
          size,
        }),
      );
      if (files.length > MAX_PACKED_FILES) {
        throw new Error("tarball exceeds the packed file count limit");
      }
      if (path === "package/package.json") {
        if (size > MAX_PACKAGE_JSON_BYTES) {
          throw new Error("packed package.json exceeds the size limit");
        }
        packageJson = buffer.subarray(contentsStart, contentsEnd);
      }
    } else if (!["5", "x", "g"].includes(type)) {
      throw new Error(`tarball contains unsupported entry type ${type}`);
    }

    offset = contentsStart + Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
  }

  if (packageJson === undefined) {
    throw new Error("tarball does not contain package/package.json");
  }
  return { files: Object.freeze(files), packageJson };
}

export async function inspectTarball(path: string): Promise<PackArtifact> {
  const compressed = await readFile(path);
  if (compressed.byteLength > MAX_TARBALL_BYTES) {
    throw new Error("tarball exceeds the compressed size limit");
  }
  const unpacked = gunzipSync(compressed, { maxOutputLength: MAX_UNPACKED_BYTES });
  const contents = inspectTar(unpacked);

  let manifest: unknown;
  try {
    manifest = JSON.parse(contents.packageJson.toString("utf8"));
  } catch {
    throw new Error("packed package.json is not valid JSON");
  }
  const candidate = manifest as { name?: unknown; version?: unknown };
  if (typeof candidate.name !== "string" || candidate.name.length === 0) {
    throw new Error("packed package name is missing or invalid");
  }
  if (typeof candidate.version !== "string" || candidate.version.length === 0) {
    throw new Error("packed package version is missing or invalid");
  }

  return Object.freeze({
    cleanup: async (): Promise<void> => {},
    files: Object.freeze(
      [...contents.files].sort((left, right) => left.path.localeCompare(right.path)),
    ),
    integrity: `sha512-${createHash("sha512").update(compressed).digest("base64")}`,
    name: candidate.name,
    path,
    sha256: await hashFile(path),
    version: candidate.version,
  });
}
