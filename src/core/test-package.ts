import { createHash } from "node:crypto";
import { runRootEsmConsumer } from "./consumer.js";
import { createDiagnostic } from "./diagnostic.js";
import { hashFile } from "./hash.js";
import type { PackageInput } from "./input.js";
import { compareCodeUnits } from "./order.js";
import { type PackArtifact, packDirectory } from "./pack.js";
import { resolvePackageInput } from "./package-input.js";
import type { PackageReport } from "./report.js";
import type { ProbeResult } from "./result.js";
import { detectExecutableVersion } from "./runtime.js";
import { inspectTarball } from "./tarball.js";

export interface TestPackageOptions {
  readonly offline?: boolean;
  readonly runtimeExecutable?: string;
}

async function tarballArtifact(path: string): Promise<PackArtifact> {
  return inspectTarball(path);
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
  if (installed?.resolved !== undefined) {
    installed.resolved = "file:<tarball>";
  }
  const legacy = parsed.dependencies?.[packageName];
  if (legacy?.resolved !== undefined) {
    legacy.resolved = "file:<tarball>";
  }
  return createHash("sha256")
    .update(JSON.stringify(canonicalJson(parsed)))
    .digest("hex");
}

export async function testPackage(
  input: PackageInput,
  options: TestPackageOptions = {},
): Promise<PackageReport> {
  const resolved = await resolvePackageInput(input);
  const runtimeExecutable = options.runtimeExecutable ?? process.execPath;
  const [runtimeVersion, npmVersion, typescript] = await Promise.all([
    detectExecutableVersion(runtimeExecutable, process.cwd()),
    detectExecutableVersion("npm", process.cwd()),
    import("typescript"),
  ]);
  const artifact =
    resolved.kind === "directory"
      ? await packDirectory(resolved.path)
      : await tarballArtifact(resolved.path);

  try {
    if ((await hashFile(artifact.path)) !== artifact.sha256) {
      throw new Error("package tarball changed after packing");
    }
    const consumer = await runRootEsmConsumer(artifact, options);
    try {
      let result: ProbeResult;
      if (consumer.install.timedOut || consumer.install.truncated) {
        result = {
          diagnostics: [],
          reason: {
            code: "resource-limit",
            message: consumer.install.timedOut
              ? "Consumer installation exceeded the time limit."
              : "Consumer installation exceeded the output limit.",
          },
          state: "not-evaluated",
        };
      } else if (consumer.install.exitCode !== 0) {
        const isOfflineMiss =
          options.offline === true &&
          /ENOTCACHED|cache miss|offline mode/i.test(
            `${consumer.install.stdout}\n${consumer.install.stderr}`,
          );
        result = isOfflineMiss
          ? {
              diagnostics: [],
              reason: {
                code: "offline-cache-miss",
                message: "The isolated npm cache did not contain every dependency.",
              },
              state: "not-evaluated",
            }
          : {
              diagnostics: [
                createDiagnostic(
                  {
                    code: "PC1000",
                    command: `npm install ${artifact.name}-${artifact.version}.tgz`,
                    evidence: `${consumer.install.stdout}\n${consumer.install.stderr}`,
                    explainedBy: null,
                    profile: {
                      moduleSystem: "esm",
                      runtime: runtimeVersion,
                      typescriptResolution: null,
                    },
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
              ],
              state: "fail",
            };
      } else if (consumer.probe?.timedOut || consumer.probe?.truncated) {
        result = {
          diagnostics: [],
          reason: {
            code: "resource-limit",
            message: consumer.probe.timedOut
              ? "Package evaluation exceeded the time limit."
              : "Package evaluation exceeded the output limit.",
          },
          state: "not-evaluated",
        };
      } else if (consumer.probe?.exitCode !== 0) {
        result = {
          diagnostics: [
            createDiagnostic(
              {
                code: "PC1001",
                command: "node <consumer>/probe.mjs",
                evidence: `${consumer.probe?.stdout ?? ""}\n${consumer.probe?.stderr ?? ""}`,
                explainedBy: null,
                profile: {
                  moduleSystem: "esm",
                  runtime: runtimeVersion,
                  typescriptResolution: null,
                },
                reproducible: true,
                severity: "error",
                subpath: ".",
                title: "Package evaluation failed",
              },
              {
                redactions: {
                  [artifact.path]: "<tarball>",
                  [consumer.path]: "<consumer>",
                },
              },
            ),
          ],
          state: "fail",
        };
      } else {
        result = { diagnostics: [], state: "pass" };
      }

      const diagnostics =
        result.state === "fail" ? Object.freeze([...result.diagnostics]) : [];
      const report: PackageReport = {
        diagnostics,
        environment: {
          architecture: process.arch,
          node: runtimeVersion,
          npm: npmVersion,
          platform: process.platform,
          profileSchema: 1,
          typescript: typescript.version,
        },
        lockfileSha256: lockfileDigest(consumer.lockfile, artifact.name),
        package: {
          files: artifact.files,
          name: artifact.name,
          sha256: artifact.sha256,
          version: artifact.version,
        },
        results: [result],
      };
      return Object.freeze(report);
    } finally {
      await consumer.cleanup();
    }
  } finally {
    await artifact.cleanup();
  }
}
