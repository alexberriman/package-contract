import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const releaseDirectory = await realpath(join(root, "release"));
const manifest = JSON.parse(
  await readFile(join(releaseDirectory, "manifest.json"), "utf8"),
);
if (
  typeof manifest.filename !== "string" ||
  basename(manifest.filename) !== manifest.filename ||
  typeof manifest.integrity !== "string"
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

execFileSync(
  "npm",
  [
    "publish",
    tarball,
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
