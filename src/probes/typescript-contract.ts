export type TypeScriptAdapterKind = "classic" | "native";

export interface ResolvedTypeScriptCompiler {
  readonly apiEntryPath: string;
  readonly kind: TypeScriptAdapterKind;
  readonly packagePath: string;
  readonly version: string;
}

export interface StructuredTypeScriptDiagnostic {
  readonly category: "error" | "message" | "suggestion" | "warning";
  readonly code: number;
  readonly end: number | null;
  readonly fileName: string | null;
  readonly message: string;
  readonly start: number | null;
}

export interface TypeScriptWorkerRequest {
  readonly compiler: ResolvedTypeScriptCompiler;
  readonly consumerPath: string;
  readonly projects: readonly {
    readonly id: string;
    readonly tsconfigPath: string;
  }[];
}

export interface TypeScriptWorkerResponse {
  readonly projects: readonly {
    readonly diagnostics: readonly StructuredTypeScriptDiagnostic[];
    readonly id: string;
  }[];
  readonly status: "completed";
  readonly version: string;
}
