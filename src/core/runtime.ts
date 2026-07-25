import { createSafeEnvironment } from "./environment.js";
import { runProcess } from "./process.js";

const SEMANTIC_VERSION = /^v?(\d+\.\d+\.\d+)$/;

export async function detectExecutableVersion(
  executable: string,
  cwd: string,
): Promise<string> {
  const result = await runProcess({
    args: ["--version"],
    cwd,
    env: createSafeEnvironment(),
    executable,
    maxOutputBytes: 1_024,
    timeoutMs: 10_000,
  });
  if (result.exitCode !== 0 || result.timedOut || result.truncated) {
    throw new Error(`could not determine the version of ${executable}`);
  }
  const match = SEMANTIC_VERSION.exec(result.stdout.trim());
  if (match?.[1] === undefined) {
    throw new Error(`${executable} returned an invalid version`);
  }
  return match[1];
}
