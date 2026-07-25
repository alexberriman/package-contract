import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createSafeEnvironment } from "../src/core/environment.js";
import { resolvePackageInput } from "../src/core/package-input.js";
import { runProcess } from "../src/core/process.js";
import { createTemporaryDirectory } from "../src/core/temporary.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("createSafeEnvironment", () => {
  it("keeps execution settings and strips credentials", () => {
    const previous = process.env.NPM_TOKEN;
    process.env.NPM_TOKEN = "secret";
    try {
      const environment = createSafeEnvironment({ CUSTOM_SAFE_VALUE: "yes" });
      expect(environment.PATH).toBe(process.env.PATH);
      expect(environment.NPM_TOKEN).toBeUndefined();
      expect(environment.CUSTOM_SAFE_VALUE).toBe("yes");
      expect(environment.LC_ALL).toBe("C");
    } finally {
      if (previous === undefined) {
        delete process.env.NPM_TOKEN;
      } else {
        process.env.NPM_TOKEN = previous;
      }
    }
  });
});

describe("runProcess", () => {
  it("captures stdout, stderr, and exit status", async () => {
    const result = await runProcess({
      args: ["-e", "process.stdout.write('out'); process.stderr.write('err')"],
      cwd: process.cwd(),
      executable: process.execPath,
    });

    expect(result).toMatchObject({
      exitCode: 0,
      stderr: "err",
      stdout: "out",
      timedOut: false,
      truncated: false,
    });
  });

  it("terminates output that exceeds the byte limit", async () => {
    const result = await runProcess({
      args: ["-e", "process.stdout.write('x'.repeat(10000)); setInterval(()=>{},1000)"],
      cwd: process.cwd(),
      executable: process.execPath,
      maxOutputBytes: 32,
    });

    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(32);
  });

  it("accepts output exactly at each stream limit", async () => {
    const result = await runProcess({
      args: ["-e", "process.stdout.write('1234'); process.stderr.write('5678')"],
      cwd: process.cwd(),
      executable: process.execPath,
      maxOutputBytes: 4,
    });

    expect(result).toMatchObject({
      exitCode: 0,
      stderr: "5678",
      stdout: "1234",
      truncated: false,
    });
  });

  it("terminates a timed-out process", async () => {
    const result = await runProcess({
      args: ["-e", "setInterval(()=>{},1000)"],
      cwd: process.cwd(),
      executable: process.execPath,
      timeoutMs: 25,
    });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });

  it("validates resource limits", () => {
    expect(() =>
      runProcess({
        args: [],
        cwd: process.cwd(),
        executable: process.execPath,
        maxOutputBytes: 0,
      }),
    ).toThrow(RangeError);
    expect(() =>
      runProcess({
        args: [],
        cwd: process.cwd(),
        executable: process.execPath,
        timeoutMs: 0,
      }),
    ).toThrow(RangeError);
  });

  it("rejects when the executable cannot be spawned", async () => {
    await expect(
      runProcess({
        args: [],
        cwd: process.cwd(),
        executable: join(tmpdir(), "package-contract-missing-executable"),
      }),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("temporary and package paths", () => {
  it("creates a private temporary directory and removes it", async () => {
    const temporary = await createTemporaryDirectory("package-contract-test-");
    await expect(
      resolvePackageInput({ kind: "directory", path: temporary.path }),
    ).resolves.toMatchObject({ kind: "directory", path: temporary.path });
    await temporary.cleanup();
    await expect(
      resolvePackageInput({ kind: "directory", path: temporary.path }),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects unsafe prefixes and mismatched input kinds", async () => {
    await expect(createTemporaryDirectory("../escape")).rejects.toThrow(TypeError);
    const root = await mkdtemp(join(tmpdir(), "package-contract-path-test-"));
    cleanupPaths.push(root);
    const file = join(root, "archive.tgz");
    const directory = join(root, "directory");
    await writeFile(file, "not a tarball");
    await mkdir(directory);

    await expect(
      resolvePackageInput({ kind: "directory", path: file }),
    ).rejects.toThrow(TypeError);
    await expect(
      resolvePackageInput({ kind: "tarball", path: directory }),
    ).rejects.toThrow(TypeError);
    await expect(
      resolvePackageInput({ kind: "tarball", path: join(root, "missing.zip") }),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      resolvePackageInput({ kind: "directory", path: "bad\u0000path" }),
    ).rejects.toThrow(TypeError);
  });
});
