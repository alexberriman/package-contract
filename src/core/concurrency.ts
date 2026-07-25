export async function mapConcurrent<T, U>(
  values: readonly T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<U>,
): Promise<readonly U[]> {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError("concurrency limit must be a positive safe integer");
  }
  const results = new Array<U>(values.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      const value = values[index];
      if (value !== undefined) {
        results[index] = await mapper(value, index);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => worker()),
  );
  return Object.freeze(results);
}
