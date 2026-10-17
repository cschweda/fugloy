// The browser's reader for the bundled examples (useWorkbench's ExampleReader).
// Paths come from the examples manifest only, never from the URL, and are
// checked to be `<id>/<file>` so nothing else on the site can be named.
const SAFE = /^[a-z-]+\/[A-Za-z0-9_]+\.[A-Za-z0-9]+$/;

export async function fetchExample(path: string): Promise<Uint8Array | null> {
  if (!SAFE.test(path)) return null;
  try {
    const res = await fetch(`/examples/${path}`);
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
}
