#!/usr/bin/env node

import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { PackageInput } from "./core/input.js";
import { testPackage } from "./core/test-package.js";
import { renderGitHubReport } from "./reporters/github.js";
import { renderHumanReport } from "./reporters/human.js";
import { serializeJsonReport } from "./reporters/json.js";

const HELP = `package-contract

Test the npm package your users actually install.

Usage:
  package-contract check [directory-or-tarball]
  package-contract check [path] --json
  package-contract check [path] --reporter github
  package-contract --help
  package-contract --version

Options:
  --include-explained  Include failures explained by Publint or ATTW
  --json               Emit a deterministic JSON report
  --offline            Require npm to install from its isolated cache
  --reporter <name>    Use the human, json, or github reporter
`;

type Reporter = "github" | "human" | "json";

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

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      help: { short: "h", type: "boolean" },
      "include-explained": { type: "boolean" },
      json: { type: "boolean" },
      offline: { type: "boolean" },
      reporter: { type: "string" },
      version: { short: "v", type: "boolean" },
    },
    strict: true,
  });

  if (values.version === true) {
    process.stdout.write("0.0.0\n");
    return;
  }
  if (values.help === true || positionals.length === 0) {
    process.stdout.write(HELP);
    return;
  }
  if (positionals[0] !== "check" || positionals.length > 2) {
    throw new Error("expected `package-contract check [directory-or-tarball]`");
  }

  const reporter = parseReporter(values.json, values.reporter);
  const input = await packageInput(positionals[1] ?? ".");
  const report = await testPackage(input, {
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
  if (report.diagnostics.some(({ severity }) => severity === "error")) {
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`package-contract: ${message}\n`);
  process.exitCode = 2;
}
