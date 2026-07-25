import { describe, expect, it } from "vitest";
import type { InstalledConsumer } from "../src/core/consumer.js";
import type { ProcessResult } from "../src/core/process.js";
import { type ConsumerProfile, defineConsumer } from "../src/index.js";
import {
  interpretTypeScriptWorkerResult,
  type PreparedTypeScriptProject,
  runTypeScriptProbes,
} from "../src/probes/typescript.js";
import type { ResolvedTypeScriptCompiler } from "../src/probes/typescript-contract.js";

const compiler: ResolvedTypeScriptCompiler = {
  apiEntryPath: "/compiler/api.js",
  kind: "native",
  packagePath: "/compiler",
  version: "7.0.2",
};
const profile = defineConsumer({
  moduleSystem: "esm",
  runtime: { version: "24.16.0" },
  typescriptResolution: "nodenext",
});
const projects: readonly PreparedTypeScriptProject[] = [
  { id: "a", profile, subpath: "." },
  { id: "b", profile, subpath: "./feature" },
];

function processResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    exitCode: 0,
    signal: null,
    stderr: "",
    stdout: "",
    timedOut: false,
    truncated: false,
    ...overrides,
  };
}

describe("interpretTypeScriptWorkerResult", () => {
  it.each([
    [
      "timeout",
      processResult({ timedOut: true }),
      "resource-limit",
      "exceeded the time",
    ],
    [
      "truncation",
      processResult({ truncated: true }),
      "resource-limit",
      "exceeded the output",
    ],
    [
      "worker exit",
      processResult({ exitCode: 1 }),
      "unavailable",
      "could not evaluate",
    ],
    [
      "invalid JSON",
      processResult({ stdout: "not json" }),
      "unavailable",
      "invalid structured",
    ],
    [
      "unsupported response",
      processResult({
        stdout: JSON.stringify({
          projects: [],
          status: "completed",
          version: "6.0.3",
        }),
      }),
      "unavailable",
      "unsupported structured",
    ],
  ])("maps %s to an explicit unavailable state", (_label, result, status, message) => {
    const outputs = interpretTypeScriptWorkerResult(
      result,
      projects,
      compiler,
      "/consumer",
    );

    expect(outputs).toHaveLength(2);
    expect(outputs.every((output) => output.result.status === status)).toBe(true);
    expect(outputs[0]?.result).toMatchObject({
      message: expect.stringContaining(message),
    });
  });

  it("normalizes, sorts, and deduplicates structured diagnostics", () => {
    const duplicate = {
      category: "error",
      code: 2307,
      end: 8,
      fileName: "/consumer/probe.mts",
      message: "missing\r\nmodule",
      start: 2,
    };
    const outputs = interpretTypeScriptWorkerResult(
      processResult({
        stdout: JSON.stringify({
          projects: [
            {
              diagnostics: [
                duplicate,
                duplicate,
                {
                  ...duplicate,
                  code: 1000,
                  fileName: "/compiler/lib.d.ts",
                },
                {
                  ...duplicate,
                  code: 9999,
                  fileName: "/elsewhere/external.d.ts",
                  start: null,
                  end: null,
                },
                {
                  ...duplicate,
                  code: 5000,
                  fileName: null,
                },
              ],
              id: "a",
            },
            { diagnostics: [], id: "b" },
          ],
          status: "completed",
          version: "7.0.2",
        }),
      }),
      projects,
      compiler,
      "/consumer",
    );

    expect(outputs[0]?.result).toMatchObject({
      diagnostics: [
        { code: 5000, fileName: null },
        { code: 2307, fileName: "<consumer>/probe.mts", message: "missing\nmodule" },
        { code: 9999, fileName: "<external>/external.d.ts" },
        { code: 1000, fileName: "<typescript>/lib.d.ts" },
      ],
      status: "completed",
      version: "7.0.2",
    });
    expect(outputs[1]?.result).toMatchObject({
      diagnostics: [],
      status: "completed",
    });
  });

  it("marks an omitted project unavailable without affecting its peers", () => {
    const outputs = interpretTypeScriptWorkerResult(
      processResult({
        stdout: JSON.stringify({
          projects: [{ diagnostics: [], id: "a" }],
          status: "completed",
          version: "7.0.2",
        }),
      }),
      projects,
      compiler,
      "/consumer",
    );

    expect(outputs.map(({ result }) => result.status)).toEqual([
      "completed",
      "unavailable",
    ]);
  });
});

describe("runTypeScriptProbes input boundaries", () => {
  const consumer = { path: "/unused" } as InstalledConsumer;

  it("returns an immutable empty result without launching a worker", async () => {
    const result = await runTypeScriptProbes(compiler, consumer, "example", []);

    expect(result).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("rejects runtime-only and CommonJS Bundler profiles", async () => {
    const runtimeOnly = defineConsumer({
      moduleSystem: "esm",
      runtime: { version: "24.16.0" },
    });
    const commonJsBundler = {
      id: {
        moduleSystem: "cjs",
        runtime: "24.16.0",
        typescriptResolution: "bundler",
      },
      runtime: {
        executable: process.execPath,
        version: "24.16.0",
      },
      subpaths: ["."],
    } as ConsumerProfile;

    await expect(
      runTypeScriptProbes(compiler, consumer, "example", [
        { profile: runtimeOnly, subpath: "." },
      ]),
    ).rejects.toThrow("requires a resolution mode");
    await expect(
      runTypeScriptProbes(compiler, consumer, "example", [
        { profile: commonJsBundler, subpath: "." },
      ]),
    ).rejects.toThrow("not applicable to CommonJS");
  });
});
