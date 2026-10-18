/** Hex dump (docs/fugloy-mcp-spec.md §4): 16 bytes a line, a gap after 8, an ASCII gutter, labels on their own lines. */

const hex2 = (/** @type {number} */ n) => n.toString(16).toUpperCase().padStart(2, '0');

/**
 * @param {ArrayLike<number>} bytes
 * @param {number} start address of `bytes[0]`
 * @param {Map<number, { name: string }>} labels
 * @returns {string}
 */
export function hexDump(bytes, start, labels) {
  const out = [];
  for (let off = 0; off < bytes.length; off += 16) {
    const n = Math.min(16, bytes.length - off);
    const addr = (start + off) & 0xffff;
    for (let k = 0; k < n; k++) {
      const label = labels.get((start + off + k) & 0xffff);
      if (label) out.push(`      ; ${label.name}`);
    }
    const groups = [];
    let ascii = '';
    for (let k = 0; k < 16; k++) {
      if (k < n) {
        const b = /** @type {number} */ (bytes[off + k]);
        groups.push(hex2(b));
        ascii += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.';
      } else groups.push('  ');
    }
    out.push(`${addr.toString(16).toUpperCase().padStart(4, '0')}  ${groups.slice(0, 8).join(' ')}  ${groups.slice(8).join(' ')}  ${ascii}`);
  }
  return out.join('\n');
}
