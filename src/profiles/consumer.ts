import type { ConsumerProfileId } from "../core/diagnostic.js";
import { compareCodeUnits } from "../core/order.js";

export interface RuntimeInput {
  readonly executable?: string;
  readonly version: string;
}

export interface ConsumerProfileInput {
  readonly moduleSystem: "cjs" | "esm";
  readonly runtime: RuntimeInput;
  readonly subpaths?: readonly string[];
  readonly typescriptResolution?: "bundler" | "node16" | "nodenext" | null;
}

export interface ConsumerProfile {
  readonly id: ConsumerProfileId;
  readonly runtime: {
    readonly executable: string;
    readonly version: string;
  };
  readonly subpaths: readonly string[];
}

const RUNTIME_VERSION = /^(?:v)?\d+(?:\.\d+){0,2}$/;

function normalizeSubpaths(subpaths: readonly string[]): readonly string[] {
  const unique = new Set<string>();
  for (const subpath of subpaths) {
    if (
      subpath !== "." &&
      (!subpath.startsWith("./") ||
        subpath
          .slice(2)
          .split("/")
          .some((segment) => segment === "" || segment === "." || segment === ".."))
    ) {
      throw new TypeError('consumer subpaths must be "." or begin with "./"');
    }
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Consumer input is validated against control bytes.
    if (/[\u0000-\u001F\u007F]/.test(subpath) || subpath.includes("\\")) {
      throw new TypeError("consumer subpaths must not contain control characters");
    }
    unique.add(subpath);
  }
  return Object.freeze([...unique].sort(compareCodeUnits));
}

export function defineConsumer(input: ConsumerProfileInput): ConsumerProfile {
  const version = input.runtime.version.replace(/^v/, "");
  if (!RUNTIME_VERSION.test(version)) {
    throw new TypeError("runtime version must contain one to three numeric parts");
  }
  if (input.moduleSystem === "cjs" && input.typescriptResolution === "bundler") {
    throw new TypeError("bundler TypeScript resolution requires an ESM consumer");
  }

  const id = Object.freeze({
    moduleSystem: input.moduleSystem,
    runtime: version,
    typescriptResolution: input.typescriptResolution ?? null,
  });

  return Object.freeze({
    id,
    runtime: Object.freeze({
      executable: input.runtime.executable ?? process.execPath,
      version,
    }),
    subpaths: normalizeSubpaths(input.subpaths ?? ["."]),
  });
}
