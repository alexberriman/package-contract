#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { comparePackages } from "./core/compare-packages.js";
import type { PackageInput } from "./core/input.js";
import { packDirectory } from "./core/pack.js";
import { materializeReproduction } from "./core/reproduction.js";
import { testPackage } from "./core/test-package.js";
import { renderHumanComparison } from "./reporters/comparison.js";
import { renderGitHubReport } from "./reporters/github.js";
import { renderHumanReport } from "./reporters/human.js";
import { serializeJson, serializeJsonReport } from "./reporters/json.js";

const HELP = `package-contract

Test the npm package your users actually install.

Usage:
  package-contract check [directory-or-tarball]
  package-contract check [path] --json
  package-contract check [path] --reporter github
  package-contract compare <before> <after> [--json]
  package-contract --help
  package-contract --version

Options:
  --include-explained  Include failures explained by Publint or ATTW
  --json               Emit a deterministic JSON report
  --offline            Require npm to install from its isolated cache
  --reporter <name>    Use the human, json, or github reporter
  --repro <id>         Write a safe runnable reproduction under ./repros
`;

type Reporter = "github" | "human" | "json";

function hasIncompleteEvaluation(
  results: Awaited<ReturnType<typeof testPackage>>["results"],
): boolean {
  return results.some(
    (result) =>
      result.state === "not-evaluated" && result.reason.code !== "inapplicable-profile",
  );
}

function hasResidualError(
  results: Awaited<ReturnType<typeof testPackage>>["results"],
): boolean {
  return results.some(
    (result) =>
      result.state === "fail" &&
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.severity === "error" && diagnostic.explainedBy === null,
      ),
  );
}

function parseReporter(json: boolean | undefined, value: string | undefined): Reporter {
  if (json === true && value !== undefined && value !== "json") {
    throw new Error("--json cannot be combined with a non-JSON reporter");
  }
  const reporter = json === true ? "json" : (value ?? "human");
  if (reporter !== "human" && reporter !== "json" && reporter !== "github") {
    throw new Error("reporter must be human, json, or github");
  }
  return reporter;
}

async function packageInput(path: string): Promise<PackageInput> {
  const absolute = resolve(path);
  const entry = await stat(absolute);
  if (entry.isDirectory()) {
    return { kind: "directory", path: absolute };
  }
  if (entry.isFile()) {
    return { kind: "tarball", path: absolute };
  }
  throw new Error("package path must be a directory or tarball");
}

async function packageVersion(): Promise<string> {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version?: unknown };
  if (typeof manifest.version !== "string") {
    throw new Error("installed package metadata does not contain a version");
  }
  return manifest.version;
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      help: { short: "h", type: "boolean" },
      "include-explained": { type: "boolean" },
      json: { type: "boolean" },
      offline: { type: "boolean" },
      reporter: { type: "string" },
      repro: { type: "string" },
      version: { short: "v", type: "boolean" },
    },
    strict: true,
  });

  if (values.version === true) {
    process.stdout.write(`${await packageVersion()}\n`);
    return;
  }
  if (values.help === true || positionals.length === 0) {
    process.stdout.write(HELP);
    return;
  }
  const reporter = parseReporter(values.json, values.reporter);
  if (positionals[0] === "compare") {
    if (positionals.length !== 3) {
      throw new Error("expected `package-contract compare <before> <after>`");
    }
    const beforePath = positionals[1];
    const afterPath = positionals[2];
    if (beforePath === undefined || afterPath === undefined) {
      throw new Error("comparison paths are required");
    }
    if (reporter === "github") {
      throw new Error("the github reporter is not available for comparisons");
    }
    const comparison = await comparePackages(
      await packageInput(beforePath),
      await packageInput(afterPath),
      {
        includeExplained: values["include-explained"] === true,
        offline: values.offline === true,
      },
    );
    process.stdout.write(
      reporter === "json"
        ? serializeJson(comparison)
        : renderHumanComparison(comparison),
    );
    if (!comparison.conclusive) {
      process.exitCode = 2;
    } else if (comparison.regressions.some(({ severity }) => severity === "error")) {
      process.exitCode = 1;
    }
    return;
  }
  if (positionals[0] !== "check" || positionals.length > 2) {
    throw new Error(
      "expected `package-contract check [directory-or-tarball]` or `package-contract compare <before> <after>`",
    );
  }

  const input = await packageInput(positionals[1] ?? ".");
  const packed =
    values.repro !== undefined && input.kind === "directory"
      ? await packDirectory(input.path)
      : null;
  try {
    const checkedInput: PackageInput =
      packed === null ? input : { kind: "tarball", path: packed.path };
    const report = await testPackage(checkedInput, {
      includeExplained: values["include-explained"] === true,
      offline: values.offline === true,
    });
    const output =
      reporter === "json"
        ? serializeJsonReport(report)
        : reporter === "github"
          ? renderGitHubReport(report)
          : renderHumanReport(report);
    process.stdout.write(output);
    if (values.repro !== undefined) {
      const reproduction = await materializeReproduction({
        diagnosticId: values.repro,
        report,
        tarballPath: checkedInput.path,
      });
      process.stderr.write(
        `Reproduction written to repros/${reproduction.diagnosticId}\n`,
      );
    }
    if (hasResidualError(report.results)) {
      process.exitCode = 1;
    } else if (hasIncompleteEvaluation(report.results)) {
      process.exitCode = 2;
    }
  } finally {
    await packed?.cleanup();
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`package-contract: ${message}\n`);
  process.exitCode = 2;
}
