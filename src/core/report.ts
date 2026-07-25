import type { Diagnostic } from "./diagnostic.js";
import type { PackedFile } from "./pack.js";
import type { ProbeResult } from "./result.js";

export type RuntimePlatform =
  | "aix"
  | "android"
  | "darwin"
  | "freebsd"
  | "haiku"
  | "linux"
  | "openbsd"
  | "sunos"
  | "win32";

export interface ReportEnvironment {
  readonly architecture: string;
  readonly node: string;
  readonly npm: string;
  readonly platform: RuntimePlatform;
  readonly profileSchema: 1;
  readonly typescript: string | null;
}

export interface PackageReport {
  readonly diagnostics: readonly Diagnostic[];
  readonly environment: ReportEnvironment;
  readonly lockfileSha256: string | null;
  readonly package: {
    readonly files: readonly PackedFile[];
    readonly name: string;
    readonly sha256: string;
    readonly version: string;
  };
  readonly results: readonly ProbeResult[];
}
