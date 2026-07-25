import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";

import { compareCodeUnits } from "./order.js";
import type { PackArtifact, PackedFile } from "./pack.js";
import { createTemporaryDirectory } from "./temporary.js";

const gunzipAsync = promisify(gunzip);
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

function validateChecksum(header: Buffer): void {
  const expected = readOctal(header, 148, 8);
  let actual = 0;
  for (let index = 0; index < TAR_BLOCK_SIZE; index += 1) {
    actual += index >= 148 && index < 156 ? 32 : (header[index] ?? 0);
  }
  if (actual !== expected) {
    throw new Error("tarball contains an invalid header checksum");
  }
}

function canonicalEntryPath(path: string): string {
  if (
    !path.startsWith("package/") ||
    path.includes("\\") ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Archive paths reject control bytes.
    /[\u0000-\u001F\u007F]/.test(path)
  ) {
    throw new Error("tarball contains an unsafe entry path");
  }
  const segments = path.split("/");
  if (
    segments.some(
      (segment, index) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        (index > 0 && /^[a-z]:$/i.test(segment)),
    )
  ) {
    throw new Error("tarball contains an ambiguous entry path");
  }
  return segments.slice(1).join("/");
}

interface TarContents {
  readonly files: readonly PackedFile[];
  readonly packageJson: Buffer;
}

function inspectTar(buffer: Buffer): TarContents {
  const files: PackedFile[] = [];
  const paths = new Set<string>();
  let packageJson: Buffer | undefined;
  let offset = 0;

  while (offset + TAR_BLOCK_SIZE <= buffer.byteLength) {
    const header = buffer.subarray(offset, offset + TAR_BLOCK_SIZE);
    if (header.every((byte) => byte === 0)) {
      break;
    }
    validateChecksum(header);

    const name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const archivePath = prefix.length > 0 ? `${prefix}/${name}` : name;
    const path = canonicalEntryPath(archivePath);
    if (paths.has(path)) {
      throw new Error("tarball contains a duplicate entry path");
    }
    paths.add(path);

    const mode = readOctal(header, 100, 8);
    const size = readOctal(header, 124, 12);
    const type = readString(header, 156, 1);
    const contentsStart = offset + TAR_BLOCK_SIZE;
    const contentsEnd = contentsStart + size;
    if (contentsEnd > buffer.byteLength) {
      throw new Error("tarball entry extends beyond the archive");
    }

    if (type === "" || type === "0") {
      files.push(Object.freeze({ mode, path, size }));
      if (files.length > MAX_PACKED_FILES) {
        throw new Error("tarball exceeds the packed file count limit");
      }
      if (path === "package.json") {
        if (size > MAX_PACKAGE_JSON_BYTES) {
          throw new Error("packed package.json exceeds the size limit");
        }
        packageJson = Buffer.from(buffer.subarray(contentsStart, contentsEnd));
      }
    } else if (type !== "5") {
      throw new Error(`tarball contains unsupported entry type ${type}`);
    }

    offset = contentsStart + Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
  }

  if (packageJson === undefined) {
    throw new Error("tarball does not contain package/package.json");
  }
  return { files: Object.freeze(files), packageJson };
}

export async function inspectTarball(sourcePath: string): Promise<PackArtifact> {
  const temporary = await createTemporaryDirectory("package-contract-artifact-");
  try {
    const compressed = await readFile(sourcePath);
    if (compressed.byteLength > MAX_TARBALL_BYTES) {
      throw new Error("tarball exceeds the compressed size limit");
    }
    const privatePath = join(temporary.path, "package.tgz");
    await writeFile(privatePath, compressed, { flag: "wx", mode: 0o600 });
    const unpacked = await gunzipAsync(compressed, {
      maxOutputLength: MAX_UNPACKED_BYTES,
    });
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
      cleanup: temporary.cleanup,
      files: Object.freeze(
        [...contents.files].sort((left, right) =>
          compareCodeUnits(left.path, right.path),
        ),
      ),
      integrity: `sha512-${createHash("sha512").update(compressed).digest("base64")}`,
      name: candidate.name,
      path: privatePath,
      sha256: createHash("sha256").update(compressed).digest("hex"),
      version: candidate.version,
    });
  } catch (error) {
    await temporary.cleanup();
    throw error;
  }
}
