/** The output cap (docs/fugloy-mcp-spec.md §7): whole lines up to a byte limit, then how to continue. */

/**
 * `offset` is a line number, so a tool paged with it re-runs and shows the next lines. `page`,
 * when a tool declares one, also caps the lines a page shows: at most `page.lines`, not counting
 * the first `page.heading` lines of the whole output (so the first page shows its heading and
 * `page.lines` more, and every later page `page.lines`) nor the trailing notice.
 * @param {string} text
 * @param {{ limit: number, offset?: number, page?: { lines: number, heading?: number } }} opts
 * @returns {string}
 */
export function cap(text, { limit, offset = 0, page }) {
  const lines = text.split('\n');
  if (offset > 0 && offset >= lines.length) return `… (no lines at offset=${offset}; the output has ${lines.length} lines)`;
  const rest = lines.slice(offset);
  const most = page === undefined ? Infinity : page.lines + Math.max(0, (page.heading ?? 0) - offset);
  if (rest.length <= most && Buffer.byteLength(rest.join('\n')) <= limit) return rest.join('\n');
  const notice = (/** @type {number} */ kept) => `… (${rest.length - kept} more ${rest.length - kept === 1 ? 'line' : 'lines'}; use offset=${offset + kept})`;
  const reserve = Buffer.byteLength(`\n${notice(0)}`);
  let used = 0;
  let kept = 0;
  for (const l of rest) {
    if (kept >= most) break;
    const size = Buffer.byteLength(l) + (kept > 0 ? 1 : 0);
    if (used + size > limit - reserve) break;
    used += size;
    kept++;
  }
  if (kept === 0) {
    // One line longer than the limit: keep what fits, so paging still advances.
    const room = Math.max(0, limit - reserve);
    return `${Buffer.from(/** @type {string} */ (rest[0])).subarray(0, room).toString('utf8').replace(/�+$/, '')}\n${notice(1)}`;
  }
  return `${rest.slice(0, kept).join('\n')}\n${notice(kept)}`;
}
