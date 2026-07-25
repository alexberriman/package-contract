import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  readdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { typescriptCompilerOptions } from "../probes/typescript.js";
import type { Diagnostic } from "./diagnostic.js";
import { hashFile } from "./hash.js";
import type { PackageReport } from "./report.js";

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
  return diagnostic.profile.moduleSystem === "esm" ? "probe.mjs" : "probe.cjs";
}

function entrySource(diagnostic: Diagnostic, packageName: string): string {
  const specifier = packageSpecifier(packageName, diagnostic.subpath);
  if (diagnostic.code === "PC1002") {
    return diagnostic.profile.moduleSystem === "esm"
      ? `import * as subject from ${JSON.stringify(specifier)};\nvoid subject;\n`
      : `import subject = require(${JSON.stringify(specifier)});\nvoid subject;\n`;
  }
  return diagnostic.profile.moduleSystem === "esm"
    ? `await import(${JSON.stringify(specifier)});\n`
    : `require(${JSON.stringify(specifier)});\n`;
}

function reproductionPackage(diagnostic: Diagnostic, report: PackageReport): object {
  const typescript =
    diagnostic.code === "PC1002" && report.environment.typescript !== null
      ? { devDependencies: { typescript: report.environment.typescript } }
      : {};
  return {
    dependencies: { [report.package.name]: "file:./package.tgz" },
    ...typescript,
    name: `package-contract-repro-${diagnostic.id}`,
    private: true,
    scripts: {
      reproduce:
        diagnostic.code === "PC1002"
          ? "tsc --noEmit -p tsconfig.json"
          : `node ${entryFile(diagnostic)}`,
    },
    type: diagnostic.profile.moduleSystem === "esm" ? "module" : "commonjs",
  };
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
  if (diagnostic.code !== "PC1001" && diagnostic.code !== "PC1002") {
    throw new Error("this diagnostic does not support a standalone reproduction");
  }
  const tarballPath = await realpath(resolve(options.tarballPath));
  if ((await hashFile(tarballPath)) !== options.report.package.sha256) {
    throw new Error("reproduction tarball does not match the report");
  }

  const requestedRoot = resolve(options.outputRoot ?? "repros");
  await mkdir(requestedRoot, { mode: 0o700, recursive: true });
  const outputRoot = await realpath(requestedRoot);
  const outputPath = join(outputRoot, diagnostic.id);
  await mkdir(outputPath, { mode: 0o700 });

  const entry = entryFile(diagnostic);
  const config = tsconfig(diagnostic);
  const files = [
    "README.md",
    entry,
    "package.json",
    "package.tgz",
    ...(config === null ? [] : ["tsconfig.json"]),
  ].sort();
  await Promise.all([
    copyFile(tarballPath, join(outputPath, "package.tgz"), constants.COPYFILE_EXCL),
    writeFile(
      join(outputPath, "package.json"),
      `${JSON.stringify(reproductionPackage(diagnostic, options.report), null, 2)}\n`,
      { mode: 0o600 },
    ),
    writeFile(
      join(outputPath, entry),
      entrySource(diagnostic, options.report.package.name),
      { mode: 0o600 },
    ),
    writeFile(
      join(outputPath, "README.md"),
      `# Reproduction ${diagnostic.id}\n\nRun:\n\n\`\`\`sh\nnpm install --ignore-scripts --no-audit --no-fund\nnpm run reproduce\n\`\`\`\n`,
      { mode: 0o600 },
    ),
    ...(config === null
      ? []
      : [
          writeFile(
            join(outputPath, "tsconfig.json"),
            `${JSON.stringify(config, null, 2)}\n`,
            { mode: 0o600 },
          ),
        ]),
  ]);
  await chmod(join(outputPath, "package.tgz"), 0o600);

  const actual = (await readdir(outputPath)).sort();
  if (JSON.stringify(actual) !== JSON.stringify(files)) {
    throw new Error("reproduction output failed its file allowlist");
  }
  for (const file of files) {
    const contents =
      file === "package.tgz"
        ? ""
        : await readFile(join(outputPath, basename(file)), "utf8");
    if (
      contents.includes(tarballPath) ||
      contents.includes(outputRoot) ||
      contents.includes(process.cwd())
    ) {
      throw new Error("reproduction output contains a host-specific path");
    }
  }

  return Object.freeze({
    diagnosticId: diagnostic.id,
    files: Object.freeze(files),
    path: outputPath,
  });
}
