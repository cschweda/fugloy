/** Test-only `.CAS` decoder, independent of the writer. */
export type Cas =
  | { kind: 'system'; name: string; blocks: { addr: number; data: Uint8Array }[]; entry: number; checksumErrors: number }
  | { kind: 'basic'; name: string; lines: { number: number; body: Uint8Array }[]; endsClean: boolean };

export function readCas(bytes: Uint8Array): Cas {
  let i = 0;
  while (bytes[i] === 0x00) i++;
  if (bytes[i++] !== 0xa5) throw new Error('no sync byte');
  if (bytes[i] === 0xd3 && bytes[i + 1] === 0xd3 && bytes[i + 2] === 0xd3) {
    const name = String.fromCharCode(bytes[i + 3]!);
    i += 4;
    let addr = 0x42e9;
    const lines: { number: number; body: Uint8Array }[] = [];
    for (;;) {
      const link = bytes[i]! | (bytes[i + 1]! << 8);
      if (link === 0) return { kind: 'basic', name, lines, endsClean: i + 2 === bytes.length };
      if (link !== addr + 4 + (bytes.indexOf(0, i + 4) - (i + 4)) + 1) throw new Error(`bad link at ${i}`);
      const end = bytes.indexOf(0, i + 4);
      lines.push({ number: bytes[i + 2]! | (bytes[i + 3]! << 8), body: bytes.slice(i + 4, end) });
      addr = link;
      i = end + 1;
    }
  }
  if (bytes[i++] !== 0x55) throw new Error('not a SYSTEM tape');
  const name = String.fromCharCode(...bytes.subarray(i, i + 6));
  i += 6;
  const blocks: { addr: number; data: Uint8Array }[] = [];
  let checksumErrors = 0;
  while (bytes[i] === 0x3c) {
    const n = bytes[i + 1] === 0 ? 256 : bytes[i + 1]!;
    const lo = bytes[i + 2]!;
    const hi = bytes[i + 3]!;
    const data = bytes.slice(i + 4, i + 4 + n);
    const sum = data.reduce((s, b) => s + b, lo + hi) & 0xff;
    if (sum !== bytes[i + 4 + n]) checksumErrors++;
    blocks.push({ addr: lo | (hi << 8), data });
    i += 5 + n;
  }
  if (bytes[i] !== 0x78) throw new Error('no entry record');
  return { kind: 'system', name, blocks, entry: bytes[i + 1]! | (bytes[i + 2]! << 8), checksumErrors };
}
