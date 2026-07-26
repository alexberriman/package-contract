import { readFile, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import type {
  ResolvedTypeScriptCompiler,
  TypeScriptAdapterKind,
} from "./typescript-contract.js";

export interface ResolveTypeScriptCompilerOptions {
  readonly invokingDirectory: string;
  readonly typescriptPath?: string;
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

export async function resolveTypeScriptCompiler(
  options: ResolveTypeScriptCompilerOptions,
): Promise<ResolvedTypeScriptCompiler | null> {
  let packageJsonPath: string;
  try {
    if (options.typescriptPath === undefined) {
      let cursor = await realpath(resolve(options.invokingDirectory));
      let found: string | undefined;
      while (found === undefined) {
        const candidate = join(cursor, "node_modules", "typescript", "package.json");
        try {
          found = await realpath(candidate);
        } catch {
          const parent = dirname(cursor);
          if (parent === cursor) {
            break;
          }
          cursor = parent;
        }
      }
      if (found === undefined) {
        return null;
      }
      packageJsonPath = found;
    } else {
      const selected = await realpath(resolve(options.typescriptPath));
      packageJsonPath = (await stat(selected)).isDirectory()
        ? join(selected, "package.json")
        : selected;
    }
    packageJsonPath = await realpath(packageJsonPath);
  } catch {
    return null;
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(packageJsonPath, "utf8"));
  } catch {
    return null;
  }
  const candidate = manifest as {
    main?: unknown;
    name?: unknown;
    version?: unknown;
  };
  if (candidate.name !== "typescript" || typeof candidate.version !== "string") {
    return null;
  }
  const match = VERSION.exec(candidate.version);
  if (match?.[1] === undefined) {
    return null;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (
    major < 5 ||
    major > 7 ||
    (major === 5 && minor < 6) ||
    (major === 7 && (minor !== 0 || patch < 2))
  ) {
    return null;
  }
  const kind: TypeScriptAdapterKind = major >= 7 ? "native" : "classic";
  const packagePath = dirname(packageJsonPath);

  let apiEntryPath: string;
  try {
    if (kind === "native") {
      const resolver = createRequire(
        join(packagePath, "__package_contract_resolver__.cjs"),
      );
      apiEntryPath = await realpath(resolver.resolve("typescript/unstable/sync"));
    } else {
      if (typeof candidate.main !== "string" || !candidate.main.startsWith("./")) {
        return null;
      }
      apiEntryPath = await realpath(join(packagePath, candidate.main));
    }
  } catch {
    return null;
  }
  if (!isInside(packagePath, apiEntryPath)) {
    return null;
  }

  return Object.freeze({
    apiEntryPath,
    kind,
    packagePath,
    version: candidate.version,
  });
}
