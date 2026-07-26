import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { unpack } from "@publint/pack";

const root = resolve(import.meta.dirname, "..");
const releaseDirectory = join(root, "release");
const packageManifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (
  typeof packageManifest.version !== "string" ||
  !/^[1-9]\d*\.\d+\.\d+$/.test(packageManifest.version)
) {
  throw new Error("release preparation requires a stable version of 1.0.0 or newer");
}
const environmentDirectory = await mkdtemp(
  join(tmpdir(), "package-contract-release-environment-"),
);
const userConfig = join(environmentDirectory, "npmrc");
const globalConfig = join(environmentDirectory, "global-npmrc");
await writeFile(
  userConfig,
  `audit=false\ncache=${join(environmentDirectory, "npm-cache")}\nfund=false\nupdate-notifier=false\n`,
  { mode: 0o600 },
);
await writeFile(globalConfig, "", { mode: 0o600 });

function safeEnvironment() {
  const environment = {};
  for (const key of [
    "ComSpec",
    "LANG",
    "PATH",
    "PATHEXT",
    "SystemRoot",
    "TEMP",
    "TMP",
    "TMPDIR",
    "WINDIR",
  ]) {
    if (process.env[key] !== undefined) {
      environment[key] = process.env[key];
    }
  }
  return {
    ...environment,
    FORCE_COLOR: "0",
    LC_ALL: "C",
    NO_COLOR: "1",
    NPM_CONFIG_GLOBALCONFIG: globalConfig,
    NPM_CONFIG_USERCONFIG: userConfig,
  };
}

function run(executable, args, cwd = root) {
  execFileSync(executable, args, {
    cwd,
    env: safeEnvironment(),
    maxBuffer: 16 * 1024 * 1024,
    stdio: "inherit",
  });
}

try {
  run("npm", ["run", "release:check"]);
  await rm(releaseDirectory, { force: true, recursive: true });
  await mkdir(releaseDirectory, { mode: 0o700 });

  const packOutput = execFileSync(
    "npm",
    ["pack", "--json", "--pack-destination", releaseDirectory],
    {
      cwd: root,
      encoding: "utf8",
      env: safeEnvironment(),
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const parsedResults = JSON.parse(packOutput);
  const results = Array.isArray(parsedResults)
    ? parsedResults
    : parsedResults !== null && typeof parsedResults === "object"
      ? Object.values(parsedResults)
      : [];
  if (results.length !== 1) {
    throw new Error("npm pack returned an unexpected result");
  }
  const result = results[0];
  if (
    typeof result.filename !== "string" ||
    typeof result.integrity !== "string" ||
    typeof result.name !== "string" ||
    typeof result.shasum !== "string" ||
    typeof result.version !== "string"
  ) {
    throw new Error("npm pack omitted release artifact metadata");
  }
  if (
    result.name !== packageManifest.name ||
    result.version !== packageManifest.version
  ) {
    throw new Error("npm pack returned an unexpected package identity");
  }
  const tarball = join(releaseDirectory, basename(result.filename));
  const bytes = await readFile(tarball);
  const unpacked = await unpack(bytes);
  const packedManifestFile = unpacked.files.find(
    ({ name }) => name === `${unpacked.rootDir}/package.json`,
  );
  if (packedManifestFile === undefined) {
    throw new Error("release tarball is missing package.json");
  }
  const packedManifest = JSON.parse(
    new TextDecoder("utf8", { fatal: true }).decode(packedManifestFile.data),
  );
  if (
    packedManifest.name !== packageManifest.name ||
    packedManifest.version !== packageManifest.version
  ) {
    throw new Error("release tarball contains an unexpected package identity");
  }
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
    if (file.name.endsWith(".map")) {
      const sourceMap = JSON.parse(text);
      if (
        !Array.isArray(sourceMap.sources) ||
        !Array.isArray(sourceMap.sourcesContent) ||
        sourceMap.sources.length !== sourceMap.sourcesContent.length ||
        sourceMap.sources.some(
          (source) =>
            typeof source !== "string" ||
            source.startsWith("/") ||
            source.includes("\\") ||
            /^[a-z]:/i.test(source),
        ) ||
        sourceMap.sourcesContent.some((source) => typeof source !== "string")
      ) {
        throw new Error(
          `release tarball contains an incomplete source map in ${file.name}`,
        );
      }
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
      [
        "--input-type=module",
        "-e",
        `const subject = await import("package-contract");
const actual = Object.keys(subject).sort();
const expected = ["comparePackages", "defineConsumer", "testPackage"];
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error(\`unexpected public exports: \${actual.join(", ")}\`);
}
try {
  await import("package-contract/core/test-package.js");
  throw new Error("internal module was publicly importable");
} catch (error) {
  if (!(error && typeof error === "object" && "code" in error && error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED")) {
    throw error;
  }
}`,
      ],
      consumer,
    );
    run(
      process.execPath,
      [join(consumer, "node_modules", ".bin", "package-contract"), "--version"],
      consumer,
    );
    await writeFile(
      join(consumer, "consumer.mts"),
      `import {
  comparePackages,
  defineConsumer,
  testPackage,
  type PackageReport,
  type TestPackageOptions,
} from "package-contract";

const profile = defineConsumer({
  moduleSystem: "esm",
  runtime: { version: "24.0.0" },
});
const options = { profiles: [profile] } satisfies TestPackageOptions;
const report: Promise<PackageReport> = testPackage(
  { kind: "directory", path: "." },
  options,
);
void comparePackages;
void report;
`,
      { mode: 0o600 },
    );
    run(
      process.execPath,
      [
        join(root, "node_modules", "typescript", "bin", "tsc"),
        "--module",
        "nodenext",
        "--moduleResolution",
        "nodenext",
        "--noEmit",
        "--strict",
        "--target",
        "es2022",
        "consumer.mts",
      ],
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
    name: packageManifest.name,
    shasum: result.shasum,
    version: packageManifest.version,
  };
  await writeFile(
    join(releaseDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o600 },
  );
  process.stdout.write(`Prepared release/${manifest.filename}\n`);
} finally {
  await rm(environmentDirectory, { force: true, recursive: true });
}
