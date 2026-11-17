export async function loadHomeRecords<T, R>(
  tasks: readonly T[],
  signal: AbortSignal,
  load: (task: T, signal: AbortSignal) => Promise<R>
): Promise<R[]> {
  const rows = new Array<R>(tasks.length);
  let next = 0;
  // Each task loads two records; keep refreshes from flooding the API pool.
  await Promise.all(Array.from({ length: Math.min(4, tasks.length) }, async () => {
    while (next < tasks.length) {
      signal.throwIfAborted();
      const index = next++;
      rows[index] = await load(tasks[index]!, signal);
      signal.throwIfAborted();
    }
  }));
  signal.throwIfAborted();
  return rows;
}
