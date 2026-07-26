type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface PackageManifest {
  readonly bin?: JsonValue;
  readonly engines?: JsonValue;
  readonly exports?: JsonValue;
  readonly name: string;
  readonly type?: "commonjs" | "module";
  readonly types?: string;
  readonly typings?: string;
  readonly version: string;
}

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const PACKAGE_VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]*$/;

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (typeof value === "object") {
    return Object.entries(value).every(
      ([key, child]) =>
        key.length > 0 &&
        // biome-ignore lint/suspicious/noControlCharactersInRegex: Manifest keys reject control bytes.
        !/[\u0000-\u001F\u007F]/.test(key) &&
        isJsonValue(child),
    );
  }
  return false;
}

export function parsePackageManifest(value: unknown): PackageManifest {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error("packed package.json must contain an object");
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.name !== "string" ||
    !PACKAGE_NAME.test(candidate.name) ||
    candidate.name.length > 214
  ) {
    throw new Error("packed package name is missing or invalid");
  }
  if (
    typeof candidate.version !== "string" ||
    !PACKAGE_VERSION.test(candidate.version) ||
    candidate.version.length > 256
  ) {
    throw new Error("packed package version is missing or invalid");
  }
  if (
    candidate.type !== undefined &&
    candidate.type !== "commonjs" &&
    candidate.type !== "module"
  ) {
    throw new Error("packed package type is invalid");
  }
  for (const key of ["types", "typings"] as const) {
    if (
      candidate[key] !== undefined &&
      (typeof candidate[key] !== "string" || candidate[key].length === 0)
    ) {
      throw new Error(`packed package ${key} is invalid`);
    }
  }
  for (const key of ["bin", "engines", "exports"] as const) {
    if (candidate[key] !== undefined && !isJsonValue(candidate[key])) {
      throw new Error(`packed package ${key} is not valid JSON data`);
    }
  }
  const bin = candidate.bin as JsonValue | undefined;
  const engines = candidate.engines as JsonValue | undefined;
  const exports = candidate.exports as JsonValue | undefined;

  return Object.freeze({
    ...(bin === undefined ? {} : { bin }),
    ...(engines === undefined ? {} : { engines }),
    ...(exports === undefined ? {} : { exports }),
    name: candidate.name,
    ...(candidate.type === undefined ? {} : { type: candidate.type }),
    ...(candidate.types === undefined ? {} : { types: candidate.types as string }),
    ...(candidate.typings === undefined
      ? {}
      : { typings: candidate.typings as string }),
    version: candidate.version,
  });
}

export function declaredBinNames(manifest: PackageManifest): ReadonlySet<string> {
  if (typeof manifest.bin === "string") {
    const slash = manifest.name.lastIndexOf("/");
    return new Set([manifest.name.slice(slash + 1)]);
  }
  if (
    manifest.bin !== null &&
    manifest.bin !== undefined &&
    !Array.isArray(manifest.bin) &&
    typeof manifest.bin === "object"
  ) {
    return new Set(
      Object.entries(manifest.bin)
        .filter(([, target]) => typeof target === "string")
        .map(([name]) => name),
    );
  }
  return new Set();
}
