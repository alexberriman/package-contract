const SAFE_ENVIRONMENT_KEYS = new Set([
  "ComSpec",
  "FORCE_COLOR",
  "LANG",
  "LC_ALL",
  "NO_COLOR",
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "TEMP",
  "TMP",
  "TMPDIR",
  "WINDIR",
]);

export function createSafeEnvironment(
  additions: Readonly<Record<string, string>> = {},
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && SAFE_ENVIRONMENT_KEYS.has(key)) {
      environment[key] = value;
    }
  }

  return {
    ...environment,
    FORCE_COLOR: "0",
    LC_ALL: "C",
    NO_COLOR: "1",
    ...additions,
  };
}
