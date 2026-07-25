import { createHash } from "node:crypto";
import { runRootEsmConsumer } from "./consumer.js";
import { createDiagnostic } from "./diagnostic.js";
import { hashFile } from "./hash.js";
import type { PackageInput } from "./input.js";
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

function lockfileDigest(lockfile: string | null): string | null {
  return lockfile === null ? null : createHash("sha256").update(lockfile).digest("hex");
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
      if (consumer.install.exitCode !== 0) {
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
        lockfileSha256: lockfileDigest(consumer.lockfile),
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
