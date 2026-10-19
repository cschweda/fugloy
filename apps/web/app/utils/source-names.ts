// Names for the user's sources: a name already taken gets a number before its
// extension (`clear-screen.z` → `clear-screen-2.z`). Shared by the Source tab's
// sources and a backup's restore.

/** `name`, or the first `stem-N.ext` (N from 2) that `taken` lacks. */
export function freeName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let i = 2; ; i++) {
    const next = `${stem}-${i}${ext}`;
    if (!taken.has(next)) return next;
  }
}

/** A new source id; never starts with a colon (the store keeps its own keys under one). */
export function newSourceId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `s-${uuid ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}
