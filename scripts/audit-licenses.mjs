import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const lockfile = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
const allowed = new Set([
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MIT",
]);
const audited = [];

for (const [path, metadata] of Object.entries(lockfile.packages)) {
  if (!path.startsWith("node_modules/") || metadata.dev === true) {
    continue;
  }
  const directory = join(root, path);
  const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  let license = manifest.license;
  if (license === undefined) {
    try {
      const text = await readFile(join(directory, "LICENSE"), "utf8");
      if (/The MIT License/i.test(text.slice(0, 256))) {
        license = "MIT";
      }
    } catch {
      license = undefined;
    }
  }
  if (
    typeof manifest.name !== "string" ||
    typeof manifest.version !== "string" ||
    typeof license !== "string"
  ) {
    throw new Error(`could not identify the license for ${path}`);
  }
  if (!allowed.has(license)) {
    throw new Error(
      `${manifest.name}@${manifest.version} uses unapproved license ${license}`,
    );
  }
  audited.push(`${manifest.name}@${manifest.version} ${license}`);
}

audited.sort();
process.stdout.write(
  `Verified ${audited.length} production package licenses:\n${audited.join("\n")}\n`,
);
