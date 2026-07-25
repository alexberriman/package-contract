import { createHash } from "node:crypto";
import { analyzeWithIncumbents } from "../integrations/incumbents.js";
import { applyIncumbentExplanations } from "../integrations/suppression.js";
import { formatTypeScriptEvidence, runTypeScriptProbe } from "../probes/typescript.js";
import type { ResolvedTypeScriptCompiler } from "../probes/typescript-contract.js";
import { resolveTypeScriptCompiler } from "../probes/typescript-resolver.js";
import {
  type ConsumerProfile,
  type ConsumerProfileInput,
  defineConsumer,
} from "../profiles/consumer.js";
import {
  declaredModuleSystems,
  declaresTypes,
  enumerateExportSubpaths,
  expandExportPatterns,
} from "../profiles/exports.js";
import { mapConcurrent } from "./concurrency.js";
import {
  type InstalledConsumer,
  installConsumer,
  runRuntimeProbe,
  runtimeProbeFilename,
} from "./consumer.js";
import {
  type ConsumerProfileId,
  compareDiagnostics,
  createDiagnostic,
  type Diagnostic,
} from "./diagnostic.js";
import { hashFile } from "./hash.js";
import type { PackageInput } from "./input.js";
import { compareCodeUnits } from "./order.js";
import { type PackArtifact, packDirectory } from "./pack.js";
import { resolvePackageInput } from "./package-input.js";
import type { PackageReport, RuntimePlatform } from "./report.js";
import type { ProbeResult } from "./result.js";
import { detectExecutableVersion } from "./runtime.js";
import { inspectTarball } from "./tarball.js";

export interface TestPackageOptions {
  readonly concurrency?: number;
  readonly includeExplained?: boolean;
  readonly invokingDirectory?: string;
  readonly npmCachePath?: string;
  readonly offline?: boolean;
  readonly profiles?: readonly ConsumerProfileInput[];
  readonly runtimeExecutable?: string;
  readonly typescriptPath?: string;
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalJson);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareCodeUnits(left, right))
        .map(([key, child]) => [key, canonicalJson(child)]),
    );
  }
  return value;
}

function lockfileDigest(lockfile: string | null, packageName: string): string | null {
  if (lockfile === null) {
    return null;
  }
  const parsed = JSON.parse(lockfile) as {
    dependencies?: Record<string, { resolved?: string }>;
    packages?: Record<
      string,
      { dependencies?: Record<string, string>; resolved?: string }
    >;
  };
  const root = parsed.packages?.[""];
  if (root?.dependencies?.[packageName] !== undefined) {
    root.dependencies[packageName] = "file:<tarball>";
  }
  const installed = parsed.packages?.[`node_modules/${packageName}`];
  if (installed !== undefined) {
    if (installed.resolved !== undefined) {
      installed.resolved = "file:<tarball>";
    }
    const normalized = installed as {
      integrity?: string;
      resolved?: string;
      version?: string;
    };
    if (normalized.integrity !== undefined) {
      normalized.integrity = "<tarball-integrity>";
    }
    if (normalized.version !== undefined) {
      normalized.version = "<package-version>";
    }
  }
  const legacy = parsed.dependencies?.[packageName];
  if (legacy?.resolved !== undefined) {
    legacy.resolved = "file:<tarball>";
  }
  return createHash("sha256")
    .update(JSON.stringify(canonicalJson(parsed)))
    .digest("hex");
}

function profileId(profile: ConsumerProfile): ConsumerProfileId {
  return profile.id;
}

function notEvaluated(
  profile: ConsumerProfile,
  subpath: string,
  code:
    | "compiler-unavailable"
    | "inapplicable-profile"
    | "offline-cache-miss"
    | "resource-limit"
    | "runtime-unavailable"
    | "unsupported-export-pattern",
  message: string,
): ProbeResult {
  return Object.freeze({
    diagnostics: [] as const,
    profile: profileId(profile),
    reason: Object.freeze({ code, message }),
    state: "not-evaluated",
    subpath,
  });
}

function passed(profile: ConsumerProfile, subpath: string): ProbeResult {
  return Object.freeze({
    diagnostics: [] as const,
    profile: profileId(profile),
    state: "pass",
    subpath,
  });
}

function failed(
  profile: ConsumerProfile,
  subpath: string,
  diagnostic: Diagnostic,
): ProbeResult {
  return Object.freeze({
    diagnostics: Object.freeze([diagnostic] as const),
    profile: profileId(profile),
    state: "fail",
    subpath,
  });
}

function defaultProfiles(
  runtimeExecutable: string,
  runtimeVersion: string,
): readonly ConsumerProfile[] {
  const runtime = { executable: runtimeExecutable, version: runtimeVersion };
  return Object.freeze([
    defineConsumer({ moduleSystem: "esm", runtime }),
    defineConsumer({ moduleSystem: "cjs", runtime }),
    defineConsumer({
      moduleSystem: "esm",
      runtime,
      typescriptResolution: "node16",
    }),
    defineConsumer({
      moduleSystem: "esm",
      runtime,
      typescriptResolution: "nodenext",
    }),
    defineConsumer({
      moduleSystem: "esm",
      runtime,
      typescriptResolution: "bundler",
    }),
    defineConsumer({
      moduleSystem: "cjs",
      runtime,
      typescriptResolution: "node16",
    }),
    defineConsumer({
      moduleSystem: "cjs",
      runtime,
      typescriptResolution: "nodenext",
    }),
  ]);
}

async function runtimeResult(
  artifact: PackArtifact,
  consumer: InstalledConsumer,
  profile: ConsumerProfile,
  subpath: string,
): Promise<ProbeResult> {
  let detectedVersion: string;
  try {
    detectedVersion = await detectExecutableVersion(
      profile.runtime.executable,
      consumer.path,
    );
  } catch {
    return notEvaluated(
      profile,
      subpath,
      "runtime-unavailable",
      "The configured Node.js executable is unavailable.",
    );
  }
  if (detectedVersion !== profile.runtime.version) {
    return notEvaluated(
      profile,
      subpath,
      "runtime-unavailable",
      `The configured executable is Node.js ${detectedVersion}, not ${profile.runtime.version}.`,
    );
  }

  const probe = await runRuntimeProbe(consumer, artifact.name, profile, subpath);
  if (probe.timedOut || probe.truncated) {
    return notEvaluated(
      profile,
      subpath,
      "resource-limit",
      probe.timedOut
        ? "Package evaluation exceeded the time limit."
        : "Package evaluation exceeded the output limit.",
    );
  }
  if (probe.exitCode === 0) {
    return passed(profile, subpath);
  }

  return failed(
    profile,
    subpath,
    createDiagnostic(
      {
        code: "PC1001",
        command: `${profile.runtime.executable} <consumer>/${runtimeProbeFilename(artifact.name, profile.id.moduleSystem, subpath)}`,
        evidence: `${probe.stdout}\n${probe.stderr}`,
        explainedBy: null,
        profile: profile.id,
        reproducible: false,
        severity: "error",
        subpath,
        title: "Package evaluation failed",
      },
      {
        redactions: {
          [artifact.path]: "<tarball>",
          [consumer.path]: "<consumer>",
        },
      },
    ),
  );
}

async function typescriptResult(
  artifact: PackArtifact,
  compiler: ResolvedTypeScriptCompiler | null,
  consumer: InstalledConsumer,
  profile: ConsumerProfile,
  subpath: string,
): Promise<ProbeResult> {
  if (compiler === null) {
    return notEvaluated(
      profile,
      subpath,
      "compiler-unavailable",
      "TypeScript could not be resolved from the invoking project.",
    );
  }
  const probe = await runTypeScriptProbe(
    compiler,
    consumer,
    artifact.name,
    profile,
    subpath,
  );
  if (probe.status !== "completed") {
    return notEvaluated(
      profile,
      subpath,
      probe.status === "resource-limit" ? "resource-limit" : "compiler-unavailable",
      probe.message,
    );
  }
  const errors = probe.diagnostics.filter(({ category }) => category === "error");
  if (errors.length === 0) {
    return passed(profile, subpath);
  }
  return failed(
    profile,
    subpath,
    createDiagnostic({
      code: "PC1002",
      command: `typescript ${profile.id.typescriptResolution} <consumer>/probe.${profile.id.moduleSystem === "esm" ? "mts" : "cts"}`,
      evidence: formatTypeScriptEvidence(errors),
      explainedBy: null,
      profile: profile.id,
      reproducible: false,
      severity: "error",
      subpath,
      title: "TypeScript consumer compilation failed",
    }),
  );
}

async function installationFailure(
  artifact: PackArtifact,
  consumer: InstalledConsumer,
  profile: ConsumerProfile,
  offline: boolean,
): Promise<ProbeResult> {
  if (consumer.install.timedOut || consumer.install.truncated) {
    return notEvaluated(
      profile,
      ".",
      "resource-limit",
      consumer.install.timedOut
        ? "Consumer installation exceeded the time limit."
        : "Consumer installation exceeded the output limit.",
    );
  }
  const evidence = `${consumer.install.stdout}\n${consumer.install.stderr}`;
  if (offline && /ENOTCACHED|cache miss|offline mode/i.test(evidence)) {
    return notEvaluated(
      profile,
      ".",
      "offline-cache-miss",
      "The isolated npm cache did not contain every dependency.",
    );
  }
  return failed(
    profile,
    ".",
    createDiagnostic(
      {
        code: "PC1000",
        command: `npm install ${artifact.name}-${artifact.version}.tgz`,
        evidence,
        explainedBy: null,
        profile: profile.id,
        reproducible: false,
        severity: "error",
        subpath: ".",
        title: "Consumer installation failed",
      },
      {
        redactions: {
          [artifact.path]: "<tarball>",
          [consumer.path]: "<consumer>",
        },
      },
    ),
  );
}

function sortResults(results: readonly ProbeResult[]): readonly ProbeResult[] {
  return Object.freeze(
    [...results].sort(
      (left, right) =>
        compareCodeUnits(left.subpath, right.subpath) ||
        compareCodeUnits(left.profile.moduleSystem, right.profile.moduleSystem) ||
        compareCodeUnits(
          left.profile.typescriptResolution ?? "",
          right.profile.typescriptResolution ?? "",
        ) ||
        compareCodeUnits(left.profile.runtime, right.profile.runtime),
    ),
  );
}

export async function testPackage(
  input: PackageInput,
  options: TestPackageOptions = {},
): Promise<PackageReport> {
  const resolved = await resolvePackageInput(input);
  const runtimeExecutable = options.runtimeExecutable ?? process.execPath;
  const [npmVersion, currentRuntimeVersion, compiler] = await Promise.all([
    detectExecutableVersion("npm", process.cwd()),
    detectExecutableVersion(runtimeExecutable, process.cwd()),
    resolveTypeScriptCompiler({
      invokingDirectory: options.invokingDirectory ?? process.cwd(),
      ...(options.typescriptPath === undefined
        ? {}
        : { typescriptPath: options.typescriptPath }),
    }),
  ]);
  const profiles =
    options.profiles === undefined
      ? defaultProfiles(runtimeExecutable, currentRuntimeVersion)
      : Object.freeze(options.profiles.map(defineConsumer));
  if (profiles.length === 0) {
    throw new TypeError("at least one consumer profile is required");
  }
  const concurrency = options.concurrency ?? 4;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16) {
    throw new RangeError("concurrency must be an integer from 1 to 16");
  }

  const artifact =
    resolved.kind === "directory"
      ? await packDirectory(resolved.path)
      : await inspectTarball(resolved.path);

  try {
    if ((await hashFile(artifact.path)) !== artifact.sha256) {
      throw new Error("package tarball changed after packing");
    }
    const incumbents = await analyzeWithIncumbents(artifact.path);
    const consumer = await installConsumer(artifact, {
      ...(options.npmCachePath === undefined
        ? {}
        : { cachePath: options.npmCachePath }),
      runtimeExecutable,
      ...(options.offline === undefined ? {} : { offline: options.offline }),
    });
    try {
      const results: ProbeResult[] = [];
      if (consumer.install.exitCode !== 0) {
        results.push(
          await installationFailure(
            artifact,
            consumer,
            profiles[0] as ConsumerProfile,
            options.offline === true,
          ),
        );
      } else {
        const exports = enumerateExportSubpaths(artifact.manifest);
        const expansion = expandExportPatterns(
          artifact.manifest,
          exports.patterns,
          artifact.files.map(({ path }) => path),
        );
        for (const pattern of expansion.unresolved) {
          results.push(
            ...profiles.map((profile) =>
              notEvaluated(
                profile,
                pattern,
                "unsupported-export-pattern",
                "The export pattern could not be enumerated safely.",
              ),
            ),
          );
        }
        const explicit = [
          ...new Set([...exports.explicit, ...expansion.expanded]),
        ].sort(compareCodeUnits);
        const tasks = profiles.flatMap((profile) =>
          (options.profiles === undefined ? explicit : profile.subpaths).map(
            (subpath) => ({ profile, subpath }),
          ),
        );
        results.push(
          ...(await mapConcurrent(tasks, concurrency, async ({ profile, subpath }) => {
            const systems = declaredModuleSystems(artifact.manifest, subpath);
            if (!systems.has(profile.id.moduleSystem)) {
              return notEvaluated(
                profile,
                subpath,
                "inapplicable-profile",
                `The package does not claim a ${profile.id.moduleSystem.toUpperCase()} entrypoint for this subpath.`,
              );
            }
            if (profile.id.typescriptResolution === null) {
              return runtimeResult(artifact, consumer, profile, subpath);
            }
            if (!declaresTypes(artifact.manifest, subpath)) {
              return notEvaluated(
                profile,
                subpath,
                "inapplicable-profile",
                "The package does not claim TypeScript declarations for this subpath.",
              );
            }
            return typescriptResult(artifact, compiler, consumer, profile, subpath);
          })),
        );
      }

      const sortedResults = sortResults(
        results.map((result) =>
          applyIncumbentExplanations(result, incumbents.findings),
        ),
      );
      const diagnostics = Object.freeze(
        sortedResults
          .flatMap((result) => (result.state === "fail" ? [...result.diagnostics] : []))
          .filter(
            (diagnostic) =>
              options.includeExplained === true || diagnostic.explainedBy === null,
          )
          .sort(compareDiagnostics),
      );
      return Object.freeze({
        diagnostics,
        environment: Object.freeze({
          architecture: process.arch,
          node: currentRuntimeVersion,
          npm: npmVersion,
          platform: process.platform as RuntimePlatform,
          profileSchema: 1,
          typescript: compiler?.version ?? null,
        }),
        incumbentFindings: incumbents.findings,
        lockfileSha256: lockfileDigest(consumer.lockfile, artifact.name),
        package: Object.freeze({
          files: artifact.files,
          name: artifact.name,
          sha256: artifact.sha256,
          version: artifact.version,
        }),
        results: sortedResults,
        tools: incumbents.tools,
      });
    } finally {
      await consumer.cleanup();
    }
  } finally {
    await artifact.cleanup();
  }
}
