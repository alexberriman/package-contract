import { spawn } from "node:child_process";

export interface RunProcessOptions {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly executable: string;
  readonly maxOutputBytes?: number;
  readonly timeoutMs?: number;
}

export interface ProcessResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
  readonly stdout: string;
  readonly timedOut: boolean;
  readonly truncated: boolean;
}

const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;
const DEFAULT_TIMEOUT_MS = 120_000;

function terminateProcessTree(child: ReturnType<typeof spawn>): void {
  if (child.pid === undefined) {
    return;
  }

  try {
    if (process.platform === "win32") {
      child.kill("SIGKILL");
    } else {
      process.kill(-child.pid, "SIGKILL");
    }
  } catch {
    child.kill("SIGKILL");
  }
}

export function runProcess(options: RunProcessOptions): Promise<ProcessResult> {
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) {
    throw new RangeError("maxOutputBytes must be a positive safe integer");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError("timeoutMs must be a positive safe integer");
  }

  return new Promise((resolve, reject) => {
    const child = spawn(options.executable, [...options.args], {
      cwd: options.cwd,
      detached: process.platform !== "win32",
      env: options.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const output = { stderr: [] as Buffer[], stdout: [] as Buffer[] };
    const outputBytes = { stderr: 0, stdout: 0 };
    let settled = false;
    let timedOut = false;
    let truncated = false;

    const finish = (result: ProcessResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const capture =
      (stream: keyof typeof output) =>
      (chunk: Buffer): void => {
        if (truncated) {
          return;
        }
        const remaining = maxOutputBytes - outputBytes[stream];
        if (remaining <= 0) {
          truncated = true;
          terminateProcessTree(child);
          return;
        }
        const accepted = chunk.subarray(0, remaining);
        output[stream].push(accepted);
        outputBytes[stream] += accepted.byteLength;
        if (accepted.byteLength < chunk.byteLength) {
          truncated = true;
          terminateProcessTree(child);
        }
      };

    child.stdout.on("data", capture("stdout"));
    child.stderr.on("data", capture("stderr"));
    child.on("error", (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on("close", (exitCode, signal) => {
      finish({
        exitCode,
        signal,
        stderr: Buffer.concat(output.stderr).toString("utf8"),
        stdout: Buffer.concat(output.stdout).toString("utf8"),
        timedOut,
        truncated,
      });
    });

    const timer = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child);
    }, timeoutMs);
    timer.unref();
  });
}
