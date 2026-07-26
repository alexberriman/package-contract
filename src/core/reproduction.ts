import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { typescriptCompilerOptions } from "../probes/typescript.js";
import { runtimeProbeSource } from "./consumer.js";
import type { Diagnostic } from "./diagnostic.js";
import { hashFile } from "./hash.js";
import type { PackageReport } from "./report.js";
import { reproductionLockfile } from "./reproduction-state.js";

export interface MaterializeReproductionOptions {
  readonly diagnosticId: string;
  readonly outputRoot?: string;
  readonly report: PackageReport;
  readonly tarballPath: string;
}

export interface Reproduction {
  readonly diagnosticId: string;
  readonly files: readonly string[];
  readonly path: string;
}

function packageSpecifier(packageName: string, subpath: string): string {
  return subpath === "." ? packageName : `${packageName}/${subpath.slice(2)}`;
}

function entryFile(diagnostic: Diagnostic): string {
  if (diagnostic.code === "PC1002") {
    return diagnostic.profile.moduleSystem === "esm" ? "probe.mts" : "probe.cts";
  }
  if (diagnostic.code === "PC1000" || diagnostic.code === "PC1004") {
    return "probe.mjs";
  }
  return diagnostic.profile.moduleSystem === "esm" ? "probe.mjs" : "probe.cjs";
}

function entrySource(diagnostic: Diagnostic, report: PackageReport): string {
  const packageName = report.package.name;
  const specifier = packageSpecifier(packageName, diagnostic.subpath);
  const runtimeGuard = `if (process.versions.node !== ${JSON.stringify(diagnostic.profile.runtime)}) {
  throw new Error(${JSON.stringify(`This reproduction requires Node ${diagnostic.profile.runtime}.`)});
}
`;
  if (diagnostic.code === "PC1000") {
    return "throw new Error('Run npm run reproduce to retry consumer installation.');\n";
  }
  if (diagnostic.code === "PC1002") {
    return diagnostic.profile.moduleSystem === "esm"
      ? `import * as subject from ${JSON.stringify(specifier)};\nvoid subject;\n`
      : `import subject = require(${JSON.stringify(specifier)});\nvoid subject;\n`;
  }
  if (diagnostic.code === "PC1004") {
    const bin = report.bins.find(({ name }) => `./bin/${name}` === diagnostic.subpath);
    if (bin === undefined) {
      throw new Error("executable action is missing from the report");
    }
    return `import { spawnSync } from "node:child_process";\nimport { fileURLToPath } from "node:url";\n${runtimeGuard}const executable = fileURLToPath(new URL(${JSON.stringify(`./node_modules/.bin/${bin.name}`)}, import.meta.url));\nconst result = spawnSync(process.execPath, [executable, ...${JSON.stringify(bin.arguments)}], { stdio: "inherit" });\nprocess.exitCode = result.status ?? 1;\n`;
  }
  if (diagnostic.code === "PC1003") {
    const failure = "Private deep import evaluated successfully.";
    const load =
      diagnostic.profile.moduleSystem === "esm"
        ? `await import(${JSON.stringify(specifier)});`
        : `require(${JSON.stringify(specifier)});`;
    return `${runtimeGuard}try {\n  ${load}\n  throw new Error(${JSON.stringify(failure)});\n} catch (error) {\n  if (error instanceof Error && error.message === ${JSON.stringify(failure)}) throw error;\n  if (!(error && typeof error === "object" && "code" in error && error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED")) throw error;\n}\n`;
  }
  return `${runtimeGuard}${runtimeProbeSource(
    packageName,
    diagnostic.profile.moduleSystem,
    diagnostic.subpath,
    report.actions.filter(({ subpath }) => subpath === diagnostic.subpath),
  )}`;
}

function reproductionCommand(diagnostic: Diagnostic, report: PackageReport): string {
  if (diagnostic.code === "PC1000") {
    return "npm install --ignore-scripts --no-audit --no-fund";
  }
  if (diagnostic.code === "PC1002") {
    if (report.environment.typescript === null) {
      throw new Error("TypeScript reproduction is missing its compiler version");
    }
    return `npx --yes --package=typescript@${report.environment.typescript} tsc --noEmit -p tsconfig.json`;
  }
  return `node ${entryFile(diagnostic)}`;
}

function reproductionPackage(diagnostic: Diagnostic, report: PackageReport): object {
  return {
    dependencies: { [report.package.name]: "file:./package.tgz" },
    name: `package-contract-repro-${diagnostic.id}`,
    private: true,
    scripts: {
      reproduce: reproductionCommand(diagnostic, report),
    },
    type: diagnostic.profile.moduleSystem === "esm" ? "module" : "commonjs",
  };
}

function lockfileForReproduction(
  report: PackageReport,
  diagnostic: Diagnostic,
): string | null {
  const captured = reproductionLockfile(report);
  if (captured === null || diagnostic.code === "PC1000") {
    return null;
  }
  const lockfile = JSON.parse(captured) as {
    name?: string;
    packages?: Record<
      string,
      {
        dependencies?: Record<string, string>;
        name?: string;
        resolved?: string;
      }
    >;
  };
  const name = `package-contract-repro-${diagnostic.id}`;
  lockfile.name = name;
  const root = lockfile.packages?.[""];
  if (root !== undefined) {
    root.name = name;
    if (root.dependencies?.[report.package.name] !== undefined) {
      root.dependencies[report.package.name] = "file:./package.tgz";
    }
  }
  const installed = lockfile.packages?.[`node_modules/${report.package.name}`];
  if (installed?.resolved !== undefined) {
    installed.resolved = "file:package.tgz";
  }
  return `${JSON.stringify(lockfile, null, 2)}\n`;
}

function tsconfig(diagnostic: Diagnostic): object | null {
  const resolution = diagnostic.profile.typescriptResolution;
  if (diagnostic.code !== "PC1002" || resolution === null) {
    return null;
  }
  return {
    compilerOptions: typescriptCompilerOptions(resolution),
    files: [`./${entryFile(diagnostic)}`],
  };
}

export async function materializeReproduction(
  options: MaterializeReproductionOptions,
): Promise<Reproduction> {
  const diagnostic = options.report.diagnostics.find(
    ({ id }) => id === options.diagnosticId,
  );
  if (diagnostic === undefined) {
    throw new Error("diagnostic ID is not present in the report");
  }
  if (!/^[a-f0-9]{16}$/.test(diagnostic.id)) {
    throw new Error("diagnostic ID is not safe for a reproduction path");
  }
  if (
    diagnostic.code !== "PC1000" &&
    diagnostic.code !== "PC1001" &&
    diagnostic.code !== "PC1002" &&
    diagnostic.code !== "PC1003" &&
    diagnostic.code !== "PC1004"
  ) {
    throw new Error("this diagnostic does not support a standalone reproduction");
  }
  const tarballPath = await realpath(resolve(options.tarballPath));

  const requestedRoot = resolve(options.outputRoot ?? "repros");
  await mkdir(requestedRoot, { mode: 0o700, recursive: true });
  const outputRoot = await realpath(requestedRoot);
  const outputPath = join(outputRoot, diagnostic.id);
  const stagingPath = await mkdtemp(join(outputRoot, `.${diagnostic.id}-`));
  await chmod(stagingPath, 0o700);
  try {
    const privateTarball = join(stagingPath, "package.tgz");
    await copyFile(tarballPath, privateTarball, constants.COPYFILE_EXCL);
    await chmod(privateTarball, 0o600);
    if ((await hashFile(privateTarball)) !== options.report.package.sha256) {
      throw new Error("reproduction tarball does not match the report");
    }

    const entry = entryFile(diagnostic);
    const config = tsconfig(diagnostic);
    const lockfile = lockfileForReproduction(options.report, diagnostic);
    const files = [
      "README.md",
      entry,
      "package.json",
      "package.tgz",
      ...(lockfile === null ? [] : ["package-lock.json"]),
      ...(config === null ? [] : ["tsconfig.json"]),
    ].sort();
    await Promise.all([
      writeFile(
        join(stagingPath, "package.json"),
        `${JSON.stringify(reproductionPackage(diagnostic, options.report), null, 2)}\n`,
        { mode: 0o600 },
      ),
      writeFile(join(stagingPath, entry), entrySource(diagnostic, options.report), {
        mode: 0o600,
      }),
      writeFile(
        join(stagingPath, "README.md"),
        `# Reproduction ${diagnostic.id}\n\nRequired runtime: Node ${diagnostic.profile.runtime}\n\nRun:\n\n\`\`\`sh\n${lockfile === null ? "npm install" : "npm ci"} --ignore-scripts --no-audit --no-fund\nnpm run reproduce\n\`\`\`\n`,
        { mode: 0o600 },
      ),
      ...(lockfile === null
        ? []
        : [
            writeFile(join(stagingPath, "package-lock.json"), lockfile, {
              mode: 0o600,
            }),
          ]),
      ...(config === null
        ? []
        : [
            writeFile(
              join(stagingPath, "tsconfig.json"),
              `${JSON.stringify(config, null, 2)}\n`,
              { mode: 0o600 },
            ),
          ]),
    ]);

    const actual = (await readdir(stagingPath)).sort();
    if (JSON.stringify(actual) !== JSON.stringify(files)) {
      throw new Error("reproduction output failed its file allowlist");
    }
    for (const file of files) {
      const contents =
        file === "package.tgz"
          ? ""
          : await readFile(join(stagingPath, basename(file)), "utf8");
      if (
        contents.includes(tarballPath) ||
        contents.includes(outputRoot) ||
        contents.includes(process.cwd())
      ) {
        throw new Error("reproduction output contains a host-specific path");
      }
    }

    await rename(stagingPath, outputPath);
    return Object.freeze({
      diagnosticId: diagnostic.id,
      files: Object.freeze(files),
      path: outputPath,
    });
  } catch (error) {
    await rm(stagingPath, { force: true, recursive: true });
    throw error;
  }
}
