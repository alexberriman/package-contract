import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import type {
  StructuredTypeScriptDiagnostic,
  TypeScriptWorkerRequest,
  TypeScriptWorkerResponse,
} from "./typescript-contract.js";

interface ClassicDiagnostic {
  readonly category: number;
  readonly code: number;
  readonly file?: { readonly fileName: string };
  readonly length?: number;
  readonly messageText:
    | string
    | { readonly messageText: unknown; readonly next?: unknown };
  readonly start?: number;
}

interface ClassicCompiler {
  readonly DiagnosticCategory: {
    readonly Error: number;
    readonly Message: number;
    readonly Suggestion: number;
    readonly Warning: number;
  };
  readonly createProgram: (options: {
    readonly options: unknown;
    readonly rootNames: readonly string[];
  }) => unknown;
  readonly flattenDiagnosticMessageText: (message: unknown, newline: string) => string;
  readonly getPreEmitDiagnostics: (program: unknown) => readonly ClassicDiagnostic[];
  readonly parseJsonConfigFileContent: (
    config: unknown,
    host: unknown,
    basePath: string,
    existingOptions: undefined,
    configFileName: string,
  ) => {
    readonly errors: readonly ClassicDiagnostic[];
    readonly fileNames: readonly string[];
    readonly options: unknown;
  };
  readonly readConfigFile: (
    path: string,
    readFile: (path: string) => string | undefined,
  ) => { readonly config: unknown; readonly error?: ClassicDiagnostic };
  readonly sys: { readonly readFile: (path: string) => string | undefined };
  readonly version: string;
}

interface NativeDiagnostic {
  readonly category: number;
  readonly code: number;
  readonly end: number;
  readonly fileName?: string;
  readonly messageChain?: readonly NativeDiagnostic[];
  readonly pos: number;
  readonly text: string;
}

interface NativeProject {
  readonly configFileName: string;
  readonly program: {
    readonly getBindDiagnostics: () => readonly NativeDiagnostic[];
    readonly getConfigFileParsingDiagnostics: () => readonly NativeDiagnostic[];
    readonly getGlobalDiagnostics: () => readonly NativeDiagnostic[];
    readonly getProgramDiagnostics: () => readonly NativeDiagnostic[];
    readonly getSemanticDiagnostics: () => readonly NativeDiagnostic[];
    readonly getSyntacticDiagnostics: () => readonly NativeDiagnostic[];
  };
}

interface NativeSnapshot {
  readonly dispose: () => void;
  readonly getProject: (path: string) => NativeProject | undefined;
  readonly getProjects: () => readonly NativeProject[];
}

interface NativeApi {
  readonly close: () => void;
  readonly updateSnapshot: (options: {
    readonly openProjects: readonly string[];
  }) => NativeSnapshot;
}

interface NativeApiConstructor {
  new (options: { readonly cwd: string }): NativeApi;
}

function category(value: number): StructuredTypeScriptDiagnostic["category"] {
  switch (value) {
    case 0:
      return "warning";
    case 1:
      return "error";
    case 2:
      return "suggestion";
    default:
      return "message";
  }
}

function flattenNativeMessage(diagnostic: NativeDiagnostic): string {
  const children =
    diagnostic.messageChain?.map(flattenNativeMessage).filter(Boolean) ?? [];
  return [diagnostic.text, ...children].filter(Boolean).join("\n");
}

function classicDiagnostic(
  compiler: ClassicCompiler,
  diagnostic: ClassicDiagnostic,
): StructuredTypeScriptDiagnostic {
  return {
    category: category(diagnostic.category),
    code: diagnostic.code,
    end:
      diagnostic.start === undefined
        ? null
        : diagnostic.start + (diagnostic.length ?? 0),
    fileName: diagnostic.file?.fileName ?? null,
    message: compiler.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    start: diagnostic.start ?? null,
  };
}

function nativeDiagnostic(
  diagnostic: NativeDiagnostic,
): StructuredTypeScriptDiagnostic {
  return {
    category: category(diagnostic.category),
    code: diagnostic.code,
    end: diagnostic.end < 0 ? null : diagnostic.end,
    fileName: diagnostic.fileName ?? null,
    message: flattenNativeMessage(diagnostic),
    start: diagnostic.pos < 0 ? null : diagnostic.pos,
  };
}

async function runClassic(
  request: TypeScriptWorkerRequest,
): Promise<readonly StructuredTypeScriptDiagnostic[]> {
  const imported = (await import(
    pathToFileURL(request.compiler.apiEntryPath).href
  )) as { readonly default?: ClassicCompiler } & Partial<ClassicCompiler>;
  const compiler = (imported.default ?? imported) as ClassicCompiler;
  const config = compiler.readConfigFile(request.tsconfigPath, compiler.sys.readFile);
  if (config.error !== undefined) {
    return [classicDiagnostic(compiler, config.error)];
  }
  const parsed = compiler.parseJsonConfigFileContent(
    config.config,
    compiler.sys,
    request.consumerPath,
    undefined,
    request.tsconfigPath,
  );
  const program = compiler.createProgram({
    options: parsed.options,
    rootNames: parsed.fileNames,
  });
  return [...parsed.errors, ...compiler.getPreEmitDiagnostics(program)].map(
    (diagnostic) => classicDiagnostic(compiler, diagnostic),
  );
}

async function runNative(
  request: TypeScriptWorkerRequest,
): Promise<readonly StructuredTypeScriptDiagnostic[]> {
  const imported = (await import(
    pathToFileURL(request.compiler.apiEntryPath).href
  )) as { readonly API: NativeApiConstructor };
  const api = new imported.API({ cwd: request.consumerPath });
  try {
    const snapshot = api.updateSnapshot({
      openProjects: [request.tsconfigPath],
    });
    try {
      const project =
        snapshot.getProject(request.tsconfigPath) ??
        snapshot
          .getProjects()
          .find(({ configFileName }) => configFileName === request.tsconfigPath);
      if (project === undefined) {
        throw new Error("TypeScript did not load the generated project");
      }
      const diagnostics = [
        ...project.program.getConfigFileParsingDiagnostics(),
        ...project.program.getProgramDiagnostics(),
        ...project.program.getGlobalDiagnostics(),
        ...project.program.getSyntacticDiagnostics(),
        ...project.program.getBindDiagnostics(),
        ...project.program.getSemanticDiagnostics(),
      ];
      return diagnostics.map(nativeDiagnostic);
    } finally {
      snapshot.dispose();
    }
  } finally {
    api.close();
  }
}

async function main(): Promise<void> {
  const requestPath = process.argv[2];
  if (requestPath === undefined) {
    throw new Error("TypeScript worker request path is required");
  }
  const request = JSON.parse(
    await readFile(requestPath, "utf8"),
  ) as TypeScriptWorkerRequest;
  const diagnostics =
    request.compiler.kind === "native"
      ? await runNative(request)
      : await runClassic(request);
  const response: TypeScriptWorkerResponse = {
    diagnostics,
    status: "completed",
    version: request.compiler.version,
  };
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

await main();
