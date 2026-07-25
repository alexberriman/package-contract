import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import type { InstalledConsumer } from "../core/consumer.js";
import { createSafeEnvironment } from "../core/environment.js";
import { compareCodeUnits } from "../core/order.js";
import { runProcess } from "../core/process.js";
import type { ConsumerProfile } from "../profiles/consumer.js";
import type {
  ResolvedTypeScriptCompiler,
  StructuredTypeScriptDiagnostic,
  TypeScriptWorkerRequest,
  TypeScriptWorkerResponse,
} from "./typescript-contract.js";

export type TypeScriptProbeResult =
  | {
      readonly diagnostics: readonly StructuredTypeScriptDiagnostic[];
      readonly status: "completed";
      readonly version: string;
    }
  | {
      readonly message: string;
      readonly status: "resource-limit" | "unavailable";
    };

function packageSpecifier(packageName: string, subpath: string): string {
  return subpath === "." ? packageName : `${packageName}/${subpath.slice(2)}`;
}

export function typescriptCompilerOptions(
  resolution: NonNullable<ConsumerProfile["id"]["typescriptResolution"]>,
): Readonly<Record<string, unknown>> {
  const shared = {
    forceConsistentCasingInFileNames: true,
    noEmit: true,
    noErrorTruncation: true,
    skipLibCheck: false,
    strict: true,
    target: "ES2022",
    types: [],
  };
  switch (resolution) {
    case "node16":
      return { ...shared, module: "Node16", moduleResolution: "Node16" };
    case "nodenext":
      return { ...shared, module: "NodeNext", moduleResolution: "NodeNext" };
    case "bundler":
      return { ...shared, module: "ESNext", moduleResolution: "Bundler" };
  }
}

function normalizedFileName(
  fileName: string | null,
  consumerPath: string,
  compilerPath: string,
): string | null {
  if (fileName === null) {
    return null;
  }
  for (const [root, token] of [
    [consumerPath, "<consumer>"],
    [compilerPath, "<typescript>"],
  ] as const) {
    const path = relative(root, fileName);
    if (path === "" || (!path.startsWith("..") && !isAbsolute(path))) {
      return path === "" ? token : `${token}/${path.replaceAll("\\", "/")}`;
    }
  }
  return `<external>/${basename(fileName)}`;
}

function normalizeDiagnostics(
  diagnostics: readonly StructuredTypeScriptDiagnostic[],
  consumerPath: string,
  compilerPath: string,
): readonly StructuredTypeScriptDiagnostic[] {
  const normalized = diagnostics.map((diagnostic) =>
    Object.freeze({
      ...diagnostic,
      fileName: normalizedFileName(diagnostic.fileName, consumerPath, compilerPath),
      message: diagnostic.message.replace(/\r\n?/g, "\n"),
    }),
  );
  normalized.sort(
    (left, right) =>
      compareCodeUnits(left.fileName ?? "", right.fileName ?? "") ||
      (left.start ?? -1) - (right.start ?? -1) ||
      (left.end ?? -1) - (right.end ?? -1) ||
      left.code - right.code ||
      compareCodeUnits(left.message, right.message),
  );
  const seen = new Set<string>();
  return Object.freeze(
    normalized.filter((diagnostic) => {
      const key = JSON.stringify(diagnostic);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    }),
  );
}

export async function runTypeScriptProbe(
  compiler: ResolvedTypeScriptCompiler,
  consumer: InstalledConsumer,
  packageName: string,
  profile: ConsumerProfile,
  subpath: string,
): Promise<TypeScriptProbeResult> {
  const resolution = profile.id.typescriptResolution;
  if (resolution === null) {
    throw new TypeError("TypeScript probe requires a resolution mode");
  }
  if (profile.id.moduleSystem === "cjs" && resolution === "bundler") {
    throw new TypeError("Bundler resolution is not applicable to CommonJS");
  }

  const extension = profile.id.moduleSystem === "esm" ? "mts" : "cts";
  const specifier = packageSpecifier(packageName, subpath);
  const token = createHash("sha256").update(specifier).digest("hex").slice(0, 12);
  const entry = join(consumer.path, `probe-${token}.${extension}`);
  const tsconfig = join(
    consumer.path,
    `tsconfig-${token}.${resolution}.${extension}.json`,
  );
  const requestPath = join(
    consumer.path,
    `typescript-${token}.${resolution}.${extension}.json`,
  );
  const source =
    profile.id.moduleSystem === "esm"
      ? `import * as subject from ${JSON.stringify(specifier)};\nvoid subject;\n`
      : `import subject = require(${JSON.stringify(specifier)});\nvoid subject;\n`;
  await Promise.all([
    writeFile(entry, source, { mode: 0o600 }),
    writeFile(
      tsconfig,
      `${JSON.stringify(
        {
          compilerOptions: typescriptCompilerOptions(resolution),
          files: [`./${basename(entry)}`],
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    ),
  ]);
  const request: TypeScriptWorkerRequest = {
    compiler,
    consumerPath: consumer.path,
    tsconfigPath: tsconfig,
  };
  await writeFile(requestPath, `${JSON.stringify(request)}\n`, { mode: 0o600 });

  const modulePath = fileURLToPath(import.meta.url);
  const worker = join(dirname(modulePath), `typescript-worker${extname(modulePath)}`);
  const result = await runProcess({
    args: [worker, requestPath],
    cwd: consumer.path,
    env: createSafeEnvironment(),
    executable: process.execPath,
    maxOutputBytes: 1024 * 1024,
    timeoutMs: 60_000,
  });
  if (result.timedOut || result.truncated) {
    return Object.freeze({
      message: result.timedOut
        ? "TypeScript exceeded the time limit."
        : "TypeScript exceeded the output limit.",
      status: "resource-limit",
    });
  }
  if (result.exitCode !== 0) {
    return Object.freeze({
      message: "TypeScript could not evaluate the generated consumer project.",
      status: "unavailable",
    });
  }

  let response: TypeScriptWorkerResponse;
  try {
    response = JSON.parse(result.stdout) as TypeScriptWorkerResponse;
  } catch {
    return Object.freeze({
      message: "TypeScript returned an invalid structured response.",
      status: "unavailable",
    });
  }
  if (
    response.status !== "completed" ||
    response.version !== compiler.version ||
    !Array.isArray(response.diagnostics)
  ) {
    return Object.freeze({
      message: "TypeScript returned an unsupported structured response.",
      status: "unavailable",
    });
  }
  return Object.freeze({
    diagnostics: normalizeDiagnostics(
      response.diagnostics,
      consumer.path,
      compiler.packagePath,
    ),
    status: "completed",
    version: response.version,
  });
}

export function formatTypeScriptEvidence(
  diagnostics: readonly StructuredTypeScriptDiagnostic[],
): string {
  return diagnostics
    .filter(({ category }) => category === "error")
    .map(({ code, end, fileName, message, start }) => {
      const location =
        fileName === null
          ? ""
          : ` ${fileName}${start === null ? "" : `:${start}-${end ?? start}`}`;
      return `TS${code}${location} ${message}`;
    })
    .join("\n");
}
