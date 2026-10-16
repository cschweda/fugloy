/**
 * Synthetic .CAS images for the cassette tests (upstream kept these in its
 * .CAS format tests and imported them from there).
 */

export function buildBasicCas(lines, { leader = 128, name = "A" } = {}) {
  const bytes = [];
  for (let i = 0; i < leader; i++) bytes.push(0x00);
  bytes.push(0xa5, 0xd3, 0xd3, 0xd3, name.charCodeAt(0));
  // Fake absolute links as a real CSAVE would (values don't matter to the
  // parser — it walks by line structure)
  let addr = 0x42e9;
  for (const { lineNo, tokens } of lines) {
    const next = addr + 5 + tokens.length;
    bytes.push(next & 0xff, next >> 8, lineNo & 0xff, lineNo >> 8, ...tokens, 0x00);
    addr = next;
  }
  bytes.push(0x00, 0x00);
  return new Uint8Array(bytes);
}

export function buildSystemCas(blocks, entry, { name = "GAME" } = {}) {
  const bytes = [];
  for (let i = 0; i < 64; i++) bytes.push(0x55);
  bytes.push(0xa5, 0x55);
  const padded = name.padEnd(6, " ");
  for (let i = 0; i < 6; i++) bytes.push(padded.charCodeAt(i));
  for (const { addr, data } of blocks) {
    bytes.push(0x3c, data.length === 256 ? 0 : data.length, addr & 0xff, addr >> 8);
    let sum = (addr & 0xff) + ((addr >> 8) & 0xff);
    for (const b of data) {
      bytes.push(b);
      sum += b;
    }
    bytes.push(sum & 0xff);
  }
  bytes.push(0x78, entry & 0xff, entry >> 8);
  return new Uint8Array(bytes);
}

// Level II tokens used in fixtures: PRINT = 0xB2
export const T_PRINT = 0xb2;
