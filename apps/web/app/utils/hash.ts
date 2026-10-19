// SHA-256 of a file's bytes, lowercase hex: Web Crypto when there is one (fast,
// off the main thread), the disassembler's own SHA-256 otherwise. Shared by the
// manuals and the ROMs, which both recognise a file by its hash.
import { sha256Hex } from '@fugloy/disasm';

export async function sha256(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle !== undefined) {
    try {
      const d = new Uint8Array(await subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
      return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // fall through
    }
  }
  return sha256Hex(bytes);
}
