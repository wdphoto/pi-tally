const storeSaveQueues = new Map<string, Promise<void>>();

export function enqueueStoreSave(path: string, task: () => Promise<void>): Promise<void> {
  const previous = storeSaveQueues.get(path) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  const settled = run.catch(() => undefined);
  storeSaveQueues.set(path, settled);
  void settled.then(() => {
    if (storeSaveQueues.get(path) === settled) storeSaveQueues.delete(path);
  });
  return run;
}

