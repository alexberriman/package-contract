export function npmPackFilename(output: string): string {
  const parsed: unknown = JSON.parse(output);
  const results = Array.isArray(parsed)
    ? parsed
    : parsed !== null && typeof parsed === "object"
      ? Object.values(parsed)
      : [];
  if (results.length !== 1) {
    throw new Error("npm pack returned an unexpected result count");
  }
  const result = results[0] as { filename?: unknown };
  if (typeof result.filename !== "string") {
    throw new Error("npm pack did not return a filename");
  }
  return result.filename;
}
