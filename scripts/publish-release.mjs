import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, copyFile, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageManifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const releaseDirectory = await realpath(join(root, "release"));
const manifest = JSON.parse(
  await readFile(join(releaseDirectory, "manifest.json"), "utf8"),
);
if (
  typeof manifest.filename !== "string" ||
  basename(manifest.filename) !== manifest.filename ||
  typeof manifest.integrity !== "string" ||
  typeof manifest.name !== "string" ||
  typeof manifest.version !== "string" ||
  !/^[1-9]\d*\.\d+\.\d+$/.test(manifest.version) ||
  packageManifest.name !== manifest.name ||
  packageManifest.version !== manifest.version
) {
  throw new Error("release manifest is invalid");
}
const tarball = await realpath(join(releaseDirectory, manifest.filename));
const relativeTarball = relative(releaseDirectory, tarball);
if (
  relativeTarball === "" ||
  relativeTarball === ".." ||
  relativeTarball.startsWith(`..${sep}`) ||
  isAbsolute(relativeTarball)
) {
  throw new Error("release tarball escaped its directory");
}
const bytes = await readFile(tarball);
const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
if (integrity !== manifest.integrity) {
  throw new Error("release tarball no longer matches its prepared integrity");
}

const privateDirectory = await mkdtemp(join(tmpdir(), "package-contract-publish-"));
try {
  const privateTarball = join(privateDirectory, manifest.filename);
  await copyFile(tarball, privateTarball, constants.COPYFILE_EXCL);
  await chmod(privateTarball, 0o600);
  const privateBytes = await readFile(privateTarball);
  const privateIntegrity = `sha512-${createHash("sha512")
    .update(privateBytes)
    .digest("base64")}`;
  if (privateIntegrity !== manifest.integrity) {
    throw new Error("private release snapshot does not match prepared integrity");
  }

  execFileSync(
    "npm",
    [
      "publish",
      privateTarball,
      "--access",
      "public",
      "--registry",
      "https://registry.npmjs.org/",
    ],
    {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    },
  );
} finally {
  await rm(privateDirectory, { force: true, recursive: true });
}
