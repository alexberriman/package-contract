import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const summary = JSON.parse(
  await readFile(resolve(root, "coverage", "coverage-summary.json"), "utf8"),
);
const minimum = {
  branches: 70,
  functions: 100,
  lines: 75,
  statements: 75,
};
const failures = [];

for (const [filename, coverage] of Object.entries(summary)) {
  if (filename === "total") {
    continue;
  }
  for (const [metric, threshold] of Object.entries(minimum)) {
    const actual = coverage[metric]?.pct;
    if (typeof actual !== "number" || actual < threshold) {
      failures.push(
        `${filename}: ${metric} coverage ${String(actual)}% is below ${threshold}%`,
      );
    }
  }
}

if (failures.length > 0) {
  throw new Error(`Per-file coverage gate failed:\n${failures.join("\n")}`);
}

process.stdout.write(
  `Per-file coverage meets ${minimum.statements}% statements, ${minimum.branches}% branches, ${minimum.functions}% functions, and ${minimum.lines}% lines.\n`,
);
