import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { ConsumerProfile } from "../profiles/consumer.js";
import { createSafeEnvironment } from "./environment.js";
import type { PackArtifact } from "./pack.js";
import { type ProcessResult, runProcess } from "./process.js";
import { createTemporaryDirectory } from "./temporary.js";

export interface ConsumerRun {
  readonly cleanup: () => Promise<void>;
  readonly install: ProcessResult;
  readonly lockfile: string | null;
  readonly path: string;
  readonly probe: ProcessResult | null;
}

export interface InstalledConsumer {
  readonly cleanup: () => Promise<void>;
  readonly install: ProcessResult;
  readonly lockfile: string | null;
  readonly path: string;
}

export interface RunConsumerOptions {
  readonly cachePath?: string;
  readonly lockfile?: string;
  readonly offline?: boolean;
  readonly runtimeExecutable?: string;
}

function packageSpecifier(packageName: string, subpath: string): string {
  return subpath === "." ? packageName : `${packageName}${subpath.slice(1)}`;
}

export function runtimeProbeFilename(
  packageName: string,
  moduleSystem: "cjs" | "esm",
  subpath: string,
): string {
  const specifier = packageSpecifier(packageName, subpath);
  const token = createHash("sha256").update(specifier).digest("hex").slice(0, 12);
  return `probe-${token}.${moduleSystem === "esm" ? "mjs" : "cjs"}`;
}

export async function installConsumer(
  artifact: PackArtifact,
  options: RunConsumerOptions = {},
): Promise<InstalledConsumer> {
  const temporary = await createTemporaryDirectory("package-contract-consumer-");
  const npmConfig = join(temporary.path, "npmrc");
  const globalNpmConfig = join(temporary.path, "global-npmrc");
  const cache = options.cachePath ?? join(temporary.path, "npm-cache");
  const relativeTarball = relative(temporary.path, artifact.path).replaceAll("\\", "/");
  const dependency = `file:${relativeTarball}`;
  await writeFile(
    join(temporary.path, "package.json"),
    `${JSON.stringify(
      {
        dependencies: { [artifact.name]: dependency },
        name: "package-contract-consumer",
        private: true,
        type: "module",
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  if (options.lockfile !== undefined) {
    await writeFile(join(temporary.path, "package-lock.json"), options.lockfile, {
      mode: 0o600,
    });
  }
  await writeFile(
    npmConfig,
    `audit=false\ncache=${cache}\nfund=false\nignore-scripts=true\nupdate-notifier=false\n`,
    { mode: 0o600 },
  );
  await writeFile(globalNpmConfig, "", { mode: 0o600 });
  try {
    const install = await runProcess({
      args: [
        options.lockfile === undefined ? "install" : "ci",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--package-lock=true",
        "--userconfig",
        npmConfig,
        "--globalconfig",
        globalNpmConfig,
        ...(options.offline ? ["--offline"] : []),
      ],
      cwd: temporary.path,
      env: createSafeEnvironment(),
      executable: "npm",
    });
    const lockfile =
      install.exitCode === 0
        ? await readFile(join(temporary.path, "package-lock.json"), "utf8")
        : null;
    return Object.freeze({
      cleanup: temporary.cleanup,
      install,
      lockfile,
      path: temporary.path,
    });
  } catch (error) {
    await temporary.cleanup();
    throw error;
  }
}

export async function runRuntimeProbe(
  consumer: InstalledConsumer,
  packageName: string,
  profile: ConsumerProfile,
  subpath: string,
): Promise<ProcessResult> {
  const esm = profile.id.moduleSystem === "esm";
  const specifier = packageSpecifier(packageName, subpath);
  const filename = runtimeProbeFilename(packageName, profile.id.moduleSystem, subpath);
  const source = esm
    ? `await import(${JSON.stringify(specifier)});\n`
    : `require(${JSON.stringify(specifier)});\n`;
  await writeFile(join(consumer.path, filename), source, { mode: 0o600 });
  return runProcess({
    args: [filename],
    cwd: consumer.path,
    env: createSafeEnvironment(),
    executable: profile.runtime.executable,
    timeoutMs: 30_000,
  });
}

export async function runRootEsmConsumer(
  artifact: PackArtifact,
  options: RunConsumerOptions = {},
): Promise<ConsumerRun> {
  const consumer = await installConsumer(artifact, options);
  const profile: ConsumerProfile = Object.freeze({
    id: Object.freeze({
      moduleSystem: "esm",
      runtime: process.version.slice(1),
      typescriptResolution: null,
    }),
    runtime: Object.freeze({
      executable: options.runtimeExecutable ?? process.execPath,
      version: process.version.slice(1),
    }),
    subpaths: Object.freeze(["."]),
  });
  const probe =
    consumer.install.exitCode === 0
      ? await runRuntimeProbe(consumer, artifact.name, profile, ".")
      : null;
  return Object.freeze({ ...consumer, probe });
}
