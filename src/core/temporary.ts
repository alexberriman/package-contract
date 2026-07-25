import { chmod, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TemporaryDirectory {
  readonly cleanup: () => Promise<void>;
  readonly path: string;
}

export async function createTemporaryDirectory(
  prefix = "package-contract-",
): Promise<TemporaryDirectory> {
  if (!/^[a-z0-9-]+$/i.test(prefix)) {
    throw new TypeError("temporary directory prefix contains unsupported characters");
  }

  const created = await mkdtemp(join(tmpdir(), prefix));
  await chmod(created, 0o700);
  const canonical = await realpath(created);
  const parent = await realpath(tmpdir());
  const expectedPrefix = `${parent}/`;
  if (!canonical.startsWith(expectedPrefix) || canonical === parent) {
    throw new Error("temporary directory escaped the operating system temp root");
  }

  return Object.freeze({
    cleanup: async (): Promise<void> => {
      await rm(canonical, { force: true, recursive: true });
    },
    path: canonical,
  });
}
