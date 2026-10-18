/**
 * stdout is the protocol (docs/fugloy-mcp-spec.md §2): one stray `console.log` corrupts the
 * JSON-RPC stream. `guardStdout` points every console method at stderr; the bin calls it before
 * anything else is imported.
 */
import { Console } from 'node:console';

let guarded = false;

/** Send console.log, info, debug, dir, table, and the rest to stderr. Idempotent. */
export function guardStdout() {
  if (guarded) return;
  guarded = true;
  const toStderr = new Console({ stdout: process.stderr, stderr: process.stderr });
  const target = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (console));
  const source = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (toStderr));
  for (const key of Object.keys(source)) {
    const fn = source[key];
    if (typeof fn === 'function') target[key] = fn.bind(toStderr);
  }
}
