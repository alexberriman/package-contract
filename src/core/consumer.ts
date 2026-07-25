import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

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

export interface RunConsumerOptions {
  readonly offline?: boolean;
  readonly runtimeExecutable?: string;
}

export async function runRootEsmConsumer(
  artifact: PackArtifact,
  options: RunConsumerOptions = {},
): Promise<ConsumerRun> {
  const temporary = await createTemporaryDirectory("package-contract-consumer-");
  const npmConfig = join(temporary.path, "npmrc");
  const globalNpmConfig = join(temporary.path, "global-npmrc");
  const cache = join(temporary.path, "npm-cache");
  await writeFile(
    join(temporary.path, "package.json"),
    `${JSON.stringify({ name: "package-contract-consumer", private: true, type: "module" }, null, 2)}\n`,
    { mode: 0o600 },
  );
  await writeFile(
    npmConfig,
    `audit=false\ncache=${cache}\nfund=false\nignore-scripts=true\nupdate-notifier=false\n`,
    { mode: 0o600 },
  );
  await writeFile(globalNpmConfig, "", { mode: 0o600 });
  await writeFile(
    join(temporary.path, "probe.mjs"),
    `await import(${JSON.stringify(artifact.name)});\n`,
    { mode: 0o600 },
  );

  try {
    const install = await runProcess({
      args: [
        "install",
        artifact.path,
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
    const probe =
      install.exitCode === 0
        ? await runProcess({
            args: ["probe.mjs"],
            cwd: temporary.path,
            env: createSafeEnvironment(),
            executable: options.runtimeExecutable ?? process.execPath,
            timeoutMs: 30_000,
          })
        : null;

    return Object.freeze({
      cleanup: temporary.cleanup,
      install,
      lockfile,
      path: temporary.path,
      probe,
    });
  } catch (error) {
    await temporary.cleanup();
    throw error;
  }
}
