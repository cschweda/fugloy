/**
 * Synthetic TRSDOS/LDOS load-module writer for fixtures. Emits records exactly
 * as the plan's ".CMD load modules" section describes them; `raw()` appends
 * bytes verbatim so tests can build malformed files.
 */
export class CmdWriter {
  private readonly out: number[] = [];

  /** One `01` record. The length byte counts the two address bytes and wraps: 254 → 0, 255 → 1, 256 → 2. */
  loadRecord(addr: number, data: ArrayLike<number>): this {
    if (data.length < 1 || data.length > 256) throw new RangeError(`load record holds 1..256 bytes, not ${data.length}`);
    this.out.push(0x01, (data.length + 2) & 0xff, addr & 0xff, (addr >> 8) & 0xff);
    for (let i = 0; i < data.length; i++) this.out.push(data[i]! & 0xff);
    return this;
  }

  /** Any amount of data, split into consecutive 256-byte `01` records. */
  load(addr: number, data: ArrayLike<number>): this {
    for (let i = 0; i < data.length; i += 256) {
      const chunk = Array.from({ length: Math.min(256, data.length - i) }, (_, k) => data[i + k]!);
      this.loadRecord(addr + i, chunk);
    }
    return this;
  }

  /** `02 02 lo hi`: transfer address; the loader stops here. */
  transfer(addr: number): this {
    this.out.push(0x02, 0x02, addr & 0xff, (addr >> 8) & 0xff);
    return this;
  }

  /** `03 00`: end of load module with no transfer address. */
  endNoTransfer(): this {
    this.out.push(0x03, 0x00);
    return this;
  }

  /** `05`: module header (program name). */
  header(name: string): this {
    return this.record(0x05, Array.from(name, (c) => c.charCodeAt(0)));
  }

  /** `1F`: copyright block. */
  copyright(text: string): this {
    return this.record(0x1f, Array.from(text, (c) => c.charCodeAt(0)));
  }

  /** Any typed record: type, length byte (0 means 256), payload. */
  record(type: number, payload: ArrayLike<number>): this {
    if (payload.length < 1 || payload.length > 256) throw new RangeError(`record payload holds 1..256 bytes, not ${payload.length}`);
    this.out.push(type & 0xff, payload.length & 0xff);
    for (let i = 0; i < payload.length; i++) this.out.push(payload[i]! & 0xff);
    return this;
  }

  /** Bytes appended verbatim: debris, truncated records, unknown types. */
  raw(bytes: ArrayLike<number>): this {
    for (let i = 0; i < bytes.length; i++) this.out.push(bytes[i]! & 0xff);
    return this;
  }

  bytes(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}
