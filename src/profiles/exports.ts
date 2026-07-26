import type { JsonValue, PackageManifest } from "../core/manifest.js";
import { compareCodeUnits } from "../core/order.js";

export interface ExportSubpaths {
  readonly explicit: readonly string[];
  readonly patterns: readonly string[];
}

function isRecord(
  value: JsonValue | undefined,
): value is { readonly [key: string]: JsonValue } {
  return value !== null && !Array.isArray(value) && typeof value === "object";
}

export function enumerateExportSubpaths(manifest: PackageManifest): ExportSubpaths {
  const exports = manifest.exports;
  if (exports === undefined) {
    return Object.freeze({
      explicit: Object.freeze(["."]),
      patterns: Object.freeze([]),
    });
  }
  if (!isRecord(exports)) {
    return Object.freeze({
      explicit: Object.freeze(["."]),
      patterns: Object.freeze([]),
    });
  }

  const keys = Object.keys(exports);
  const subpathKeys = keys.filter((key) => key.startsWith("."));
  if (subpathKeys.length === 0) {
    return Object.freeze({
      explicit: Object.freeze(["."]),
      patterns: Object.freeze([]),
    });
  }
  if (subpathKeys.length !== keys.length) {
    throw new Error("package exports mixes condition and subpath keys");
  }

  const explicit = subpathKeys.filter(
    (key) => !key.includes("*") && exports[key] !== null,
  );
  const patterns = subpathKeys.filter(
    (key) => key.includes("*") && exports[key] !== null,
  );
  return Object.freeze({
    explicit: Object.freeze(explicit.sort(compareCodeUnits)),
    patterns: Object.freeze(patterns.sort(compareCodeUnits)),
  });
}

function targetSupportsConditions(
  target: JsonValue,
  conditions: ReadonlySet<string>,
): boolean {
  if (typeof target === "string") {
    return true;
  }
  if (Array.isArray(target)) {
    return target.some((entry) => targetSupportsConditions(entry, conditions));
  }
  if (isRecord(target)) {
    for (const [key, value] of Object.entries(target)) {
      if (key === "types") {
        continue;
      }
      if (key === "default" || conditions.has(key)) {
        return targetSupportsConditions(value, conditions);
      }
    }
  }
  return false;
}

function targetForSubpath(
  exports: { readonly [key: string]: JsonValue },
  subpath: string,
): JsonValue {
  if (exports[subpath] !== undefined) {
    return exports[subpath] as JsonValue;
  }
  const matches = Object.entries(exports).filter(([key]) => {
    const parts = key.split("*");
    return (
      parts.length === 2 &&
      subpath.startsWith(parts[0] ?? "") &&
      subpath.endsWith(parts[1] ?? "") &&
      !subpath
        .slice((parts[0] ?? "").length, subpath.length - (parts[1] ?? "").length)
        .includes("/")
    );
  });
  return matches.length === 1 ? (matches[0]?.[1] ?? null) : null;
}

export function declaredModuleSystems(
  manifest: PackageManifest,
  subpath: string,
): ReadonlySet<"cjs" | "esm"> {
  const systems = new Set<"cjs" | "esm">();
  const exports = manifest.exports;
  if (exports === undefined) {
    systems.add("cjs");
    systems.add("esm");
    return systems;
  }

  let target = exports;
  if (isRecord(exports)) {
    const keys = Object.keys(exports);
    if (keys.some((key) => key.startsWith("."))) {
      target = targetForSubpath(exports, subpath);
    }
  }
  const sharedConditions = ["module-sync", "node", "node-addons"];
  if (targetSupportsConditions(target, new Set([...sharedConditions, "import"]))) {
    systems.add("esm");
  }
  if (targetSupportsConditions(target, new Set([...sharedConditions, "require"]))) {
    systems.add("cjs");
  }
  return systems;
}

function containsTypesCondition(target: JsonValue): boolean {
  if (Array.isArray(target)) {
    return target.some(containsTypesCondition);
  }
  if (isRecord(target)) {
    return Object.entries(target).some(
      ([key, value]) => key === "types" || containsTypesCondition(value),
    );
  }
  return false;
}

export function declaresTypes(manifest: PackageManifest, subpath: string): boolean {
  const exports = manifest.exports;
  if (exports === undefined) {
    return (
      subpath === "." &&
      (manifest.types !== undefined || manifest.typings !== undefined)
    );
  }
  let target = exports;
  if (isRecord(exports) && Object.keys(exports).some((key) => key.startsWith("."))) {
    target = targetForSubpath(exports, subpath);
  }
  return containsTypesCondition(target);
}

function collectStringTargets(target: JsonValue, targets: Set<string>): void {
  if (typeof target === "string") {
    targets.add(target);
  } else if (Array.isArray(target)) {
    for (const entry of target) {
      collectStringTargets(entry, targets);
    }
  } else if (isRecord(target)) {
    for (const value of Object.values(target)) {
      collectStringTargets(value, targets);
    }
  }
}

export interface ExpandedExportPatterns {
  readonly expanded: readonly string[];
  readonly unresolved: readonly string[];
}

export function expandExportPatterns(
  manifest: PackageManifest,
  patterns: readonly string[],
  packedFiles: readonly string[],
): ExpandedExportPatterns {
  if (!isRecord(manifest.exports)) {
    return Object.freeze({
      expanded: Object.freeze([]),
      unresolved: Object.freeze([...patterns].sort(compareCodeUnits)),
    });
  }

  const expanded = new Set<string>();
  const unresolved: string[] = [];
  for (const pattern of patterns) {
    const keyParts = pattern.split("*");
    const target = manifest.exports[pattern];
    const targets = new Set<string>();
    if (target !== undefined) {
      collectStringTargets(target, targets);
    }
    let matched = false;
    if (keyParts.length === 2) {
      for (const candidate of targets) {
        const targetParts = candidate.split("*");
        if (
          targetParts.length !== 2 ||
          !candidate.startsWith("./") ||
          candidate.includes("..")
        ) {
          continue;
        }
        const prefix = targetParts[0]?.slice(2) ?? "";
        const suffix = targetParts[1] ?? "";
        for (const file of packedFiles) {
          if (
            !file.endsWith(".js") &&
            !file.endsWith(".mjs") &&
            !file.endsWith(".cjs")
          ) {
            continue;
          }
          if (!file.startsWith(prefix) || !file.endsWith(suffix)) {
            continue;
          }
          const capture = file.slice(prefix.length, file.length - suffix.length);
          if (capture.length === 0 || capture.includes("/")) {
            continue;
          }
          const subpath = `${keyParts[0]}${capture}${keyParts[1]}`;
          if (
            subpath.startsWith("./") &&
            !subpath.includes("\\") &&
            !subpath.split("/").includes("..")
          ) {
            expanded.add(subpath);
            matched = true;
          }
        }
      }
    }
    if (!matched) {
      unresolved.push(pattern);
    }
  }
  return Object.freeze({
    expanded: Object.freeze([...expanded].sort(compareCodeUnits)),
    unresolved: Object.freeze(unresolved.sort(compareCodeUnits)),
  });
}

export function selectBlockedDeepImport(
  manifest: PackageManifest,
  packedFiles: readonly string[],
): string | null {
  if (manifest.exports === undefined) {
    return null;
  }
  const candidates = packedFiles
    .filter(
      (file) =>
        (file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs")) &&
        !file.includes("\\") &&
        !file.split("/").includes(".."),
    )
    .map((file) => `./${file}`)
    .filter((subpath) => declaredModuleSystems(manifest, subpath).size === 0)
    .sort(compareCodeUnits);
  return candidates[0] ?? null;
}
