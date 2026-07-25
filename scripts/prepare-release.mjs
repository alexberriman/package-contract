import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { unpack } from "@publint/pack";

const root = resolve(import.meta.dirname, "..");
const releaseDirectory = join(root, "release");

function run(executable, args, cwd = root) {
  execFileSync(executable, args, {
    cwd,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    maxBuffer: 16 * 1024 * 1024,
    stdio: "inherit",
  });
}

run("npm", ["run", "release:check"]);
await rm(releaseDirectory, { force: true, recursive: true });
await mkdir(releaseDirectory, { mode: 0o700 });

const packOutput = execFileSync(
  "npm",
  ["pack", "--json", "--pack-destination", releaseDirectory],
  {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    maxBuffer: 16 * 1024 * 1024,
  },
);
const results = JSON.parse(packOutput);
if (!Array.isArray(results) || results.length !== 1) {
  throw new Error("npm pack returned an unexpected result");
}
const result = results[0];
if (
  typeof result.filename !== "string" ||
  typeof result.integrity !== "string" ||
  typeof result.shasum !== "string"
) {
  throw new Error("npm pack omitted release artifact metadata");
}
const tarball = join(releaseDirectory, basename(result.filename));
const bytes = await readFile(tarball);
const unpacked = await unpack(bytes);
const names = unpacked.files.map(({ name }) =>
  name.startsWith(`${unpacked.rootDir}/`)
    ? name.slice(unpacked.rootDir.length + 1)
    : name,
);
for (const required of ["LICENSE", "README.md", "package.json"]) {
  if (!names.includes(required)) {
    throw new Error(`release tarball is missing ${required}`);
  }
}
if (
  names.some(
    (name) =>
      name.startsWith("src/") ||
      name.startsWith("test/") ||
      name === ".env" ||
      name.startsWith(".env."),
  )
) {
  throw new Error("release tarball contains a forbidden development file");
}

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bnpm_[A-Za-z0-9]{36}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
];
for (const file of unpacked.files) {
  if (file.data.includes(0)) {
    continue;
  }
  const text = new TextDecoder("utf8", { fatal: false }).decode(file.data);
  if (secretPatterns.some((pattern) => pattern.test(text))) {
    throw new Error(`release tarball contains a credential pattern in ${file.name}`);
  }
}

run("npx", ["--no-install", "publint", tarball]);
run("npx", ["--no-install", "attw", "--pack", tarball, "--profile", "esm-only"]);
run("node", ["dist/cli.js", "check", tarball]);
const consumer = await mkdtemp(join(tmpdir(), "package-contract-release-"));
try {
  run(
    "npm",
    ["install", tarball, "--ignore-scripts", "--no-audit", "--no-fund"],
    consumer,
  );
  run(
    "node",
    ["--input-type=module", "-e", "await import('package-contract')"],
    consumer,
  );
} finally {
  await rm(consumer, { force: true, recursive: true });
}

const sha512 = createHash("sha512").update(bytes).digest("base64");
if (`sha512-${sha512}` !== result.integrity) {
  throw new Error("release tarball integrity does not match npm pack metadata");
}
const manifest = {
  filename: basename(tarball),
  integrity: result.integrity,
  shasum: result.shasum,
};
await writeFile(
  join(releaseDirectory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { mode: 0o600 },
);
process.stdout.write(`Prepared release/${manifest.filename}\n`);
