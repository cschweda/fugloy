# Emu Phase 0: Extract trs80-emulator and Boot to READY — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the DOM-free core of `cschweda/trs80-emulator` (commit `11612849c7e4dbbe76a45b38116486223fb05a9a`, v1.6.0) into `packages/emu` as plain ESM, prove it runs with no platform globals, and boot the Model III ROM named in `fugloy.mcp.json` to `READY` in Node.

**Architecture:** Thirteen hardware-emulation modules (CPU, memory, I/O, system, keyboard, cassette, tape codec, FDC, disk images, printer, `.CAS` and `.CMD` formats, save state) move into the spec's folders with relative imports; the canvas renderer, the WebAudio driver, the turbo throttle, the UI, the catalogs, and every asset (ROM, disks, games) stay upstream. Two small edits make the code platform-free: an injected logger in place of `console`, and a pure base64 in place of `Buffer`/`atob`/`btoa`; the keyboard's unused DOM hooks go. A `node:vm` check links and runs the package in an empty context, a static scan guards the paths it does not run, and a boot test runs the real ROM to `READY` when `fugloy.mcp.json` names it.

**Tech Stack:** Plain JavaScript ESM (no TypeScript), the root Vitest 5 config, Node 22's `vm.SourceTextModule` (behind `--experimental-vm-modules`) for the zero-DOM check.

**Spec:** `docs/fugloy-emu-spec.md` — §2 (principles 1, 2, 5), §3 (layout), §11 phase 0: "Extract `cschweda/trs80-emulator` into `packages/emu`; strip DOM; ESM; test runner — Boots to `READY` in Node with no DOM stubs." The kickoff brief (2026-10-14): "…get it booting to READY in Node with the Model III ROM from fugloy.mcp.json. Stop at Phase 0." `fugloy.mcp.json`'s format: `docs/fugloy-mcp-spec.md` §3.

## Global Constraints

- `packages/emu` is plain JavaScript ESM: no TypeScript, no runtime dependencies, no Node or DOM APIs in `packages/emu/src` (CLAUDE.md; spec §2.1, §2.5).
- Zero DOM, as the spec words it: "Verified by a CI step that loads the package inside `node:vm` with an empty context object; any reference to a browser global throws."
- Deterministic: "All timing is cycle-based, never wall-clock" (spec §2.2).
- ROMs are never bundled or committed; the caller supplies bytes (spec §5). `fugloy.mcp.json` holds local paths and stays out of git.
- Nothing from upstream `public/` (the ROM, disk images, programs) or `docs/` (one file holds the ROM as Intel HEX) enters the repository.
- Stop at phase 0: no `Machine` facade, no new devices, no loader API, no ZEXALL, no CPU fixes. Upstream's DD/FD prefix fallback and the `strictMode = false` default wait for emu phase 1.
- Upstream is MIT, "Copyright (c) 2024 TRS-80 Model III Emulator Contributors"; the notice travels with the code.
- Commits: imperative, one line, prefixed `emu0:`, no AI co-author trailers.

## Review Focus

1. A ported module that reaches a platform global only on a rarely run path (an error branch, a tape callback). The `vm` check runs the main paths; Task 2's static scan covers the rest.
2. An import that resolves under Vitest but not under Node's own rules (an alias left behind, a missing `.js`). Task 1's plain-Node import test and Task 3's `vm` linker both use Node's rules.
3. `fugloy.mcp.json`: a ROM path must resolve against the config file's folder, not the working directory, and a config that names a missing ROM must fail, not skip. Task 5 tests both.
4. Determinism: two boots from reset reach `READY` at the same T-state with the same screen. Task 5 tests it.
5. Drift from upstream during the move: every ported upstream test passes with changes limited to import paths, explicit Vitest imports, ROM access, and the removed wall-clock assertion. Task 4 and Task 5 record the counts.

---

### Task 1: Extract the core modules

**Files:**
- Create (copied from upstream): `packages/emu/src/cpu/z80cpu.js`, `packages/emu/src/machine/{memory,io,trs80-system}.js`, `packages/emu/src/devices/{keyboard,cassette,cassette-tape,fdc-wd1793,disk-image,printer}.js`, `packages/emu/src/loaders/{cas-format,cmd-format}.js`, `packages/emu/src/debug/state.js`
- Create: `packages/emu/NOTICE.md`
- Modify: `packages/emu/src/index.js`, `packages/emu/test/import.test.js`, `packages/emu/README.md`

**Interfaces:**
- Produces `packages/emu/src/index.js`, re-exporting upstream's names unchanged: `TRS80System`, `CPU_CLOCK_HZ`, `RTC_HZ`, `RTC_INTERVAL_TSTATES`; `Z80CPU`; `MemorySystem`; `IOSystem`, `RTC_IRQ_BIT`, `CASSETTE_RISE_IRQ_BIT`, `CASSETTE_FALL_IRQ_BIT`, `NMI_INTRQ_BIT`, `MODE_32COL_BIT`; `KeyboardMatrix`; `CassetteSystem`; `casToPulses`, `pulsesToBytes`, `ensureLeader`; `FDC1793`, `parseWriteTrackStream`; `DiskImage`; `Printer`; `parseCas`, `fastLoadBasic`, `fastLoadSystem`; `parseCmd`, `fastLoadCmd`; `STATE_VERSION`, `STATE_MACHINE`, `toBase64`, `fromBase64`, `serializeState`, `restoreState`.
- `new TRS80System({ romData })` with `runTStates(budget)`, `runSeconds(s)`, `typeText(text)`, `screenText()` (16 strings of 64), `bootToCassetteBasic()`, `keyboard.keyDown(key, code)` / `keyUp(code)`, `cpu.cycles`, `memory.videoRam`.

- [ ] **Step 1: Get upstream at the pinned commit**

```bash
UP="${TMPDIR:-/tmp}/trs80-emulator"
git clone https://github.com/cschweda/trs80-emulator "$UP"
git -C "$UP" checkout 11612849c7e4dbbe76a45b38116486223fb05a9a
```

- [ ] **Step 2: Write the failing tests** — replace `packages/emu/test/import.test.js`:

```js
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import * as emu from '../src/index.js';

const index = fileURLToPath(new URL('../src/index.js', import.meta.url));

it('exports the extracted core', () => {
  for (const name of ['TRS80System', 'Z80CPU', 'MemorySystem', 'IOSystem', 'KeyboardMatrix', 'CassetteSystem', 'FDC1793', 'DiskImage', 'Printer', 'parseCas', 'parseCmd', 'serializeState', 'restoreState']) {
    expect(typeof emu[name], name).toBe('function');
  }
  expect(emu.CPU_CLOCK_HZ).toBe(2027520);
});

it('imports under plain Node, with no Vitest resolver in between', () => {
  const code = `const m = await import(${JSON.stringify(pathToFileURL(index).href)}); if (typeof m.TRS80System !== 'function') process.exit(3);`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
});
```

- [ ] **Step 3: Run them and see them fail**

Run: `pnpm -s vitest run packages/emu/test/import.test.js`
Expected: FAIL — `typeof emu.TRS80System` is `undefined`.

- [ ] **Step 4: Copy the modules into the spec's folders**

```bash
E=packages/emu/src
mkdir -p $E/cpu $E/machine $E/devices $E/loaders $E/debug
cp "$UP/src/core/z80cpu.js" $E/cpu/
cp "$UP/src/core/memory.js" "$UP/src/core/io.js" "$UP/src/system/trs80-system.js" $E/machine/
cp "$UP/src/peripherals/"{keyboard,cassette,cassette-tape,fdc-wd1793,disk-image,printer}.js $E/devices/
cp "$UP/src/peripherals/"{cas-format,cmd-format}.js $E/loaders/
cp "$UP/src/system/state.js" $E/debug/
```

- [ ] **Step 5: Rewrite the Vite aliases as relative imports** (each line occurs once)

| File | Replace | With |
| --- | --- | --- |
| `machine/trs80-system.js` | `"@core/z80cpu.js"` | `"../cpu/z80cpu.js"` |
| `machine/trs80-system.js` | `"@core/memory.js"` | `"./memory.js"` |
| `machine/trs80-system.js` | `"@core/io.js"` | `"./io.js"` |
| `machine/trs80-system.js` | `"@peripherals/keyboard.js"` | `"../devices/keyboard.js"` |
| `machine/io.js` | `"@peripherals/cassette.js"` | `"../devices/cassette.js"` |
| `machine/io.js` | `"@peripherals/fdc-wd1793.js"` | `"../devices/fdc-wd1793.js"` |
| `machine/io.js` | `"@peripherals/printer.js"` | `"../devices/printer.js"` |
| `devices/cassette.js` | `"@peripherals/cassette-tape.js"` | `"./cassette-tape.js"` |
| `debug/state.js` | `"@peripherals/disk-image.js"` | `"../devices/disk-image.js"` |

Then `grep -rn 'from "@' packages/emu/src` must print nothing.

- [ ] **Step 6: Remove the keyboard's DOM hooks** — in `devices/keyboard.js`, delete from the line `  /** Attach DOM listeners; handled keys are swallowed (preventDefault). */` through the closing brace of `detach()` (the `attach(element)` and `detach()` methods; nothing else calls them: `grep -rn "\.attach(\|\.detach(" packages/emu/src` prints nothing afterwards).

- [ ] **Step 7: Write `packages/emu/src/index.js`**

```js
/**
 * @fugloy/emu — headless, deterministic TRS-80 Model III emulator core.
 * Extracted in emu phase 0 from cschweda/trs80-emulator at 11612849 (v1.6.0); see NOTICE.md.
 */
export { TRS80System, CPU_CLOCK_HZ, RTC_HZ, RTC_INTERVAL_TSTATES } from './machine/trs80-system.js';
export { Z80CPU } from './cpu/z80cpu.js';
export { MemorySystem } from './machine/memory.js';
export { IOSystem, RTC_IRQ_BIT, CASSETTE_RISE_IRQ_BIT, CASSETTE_FALL_IRQ_BIT, NMI_INTRQ_BIT, MODE_32COL_BIT } from './machine/io.js';
export { KeyboardMatrix } from './devices/keyboard.js';
export { CassetteSystem } from './devices/cassette.js';
export { casToPulses, pulsesToBytes, ensureLeader } from './devices/cassette-tape.js';
export { FDC1793, parseWriteTrackStream } from './devices/fdc-wd1793.js';
export { DiskImage } from './devices/disk-image.js';
export { Printer } from './devices/printer.js';
export { parseCas, fastLoadBasic, fastLoadSystem } from './loaders/cas-format.js';
export { parseCmd, fastLoadCmd } from './loaders/cmd-format.js';
export { STATE_VERSION, STATE_MACHINE, toBase64, fromBase64, serializeState, restoreState } from './debug/state.js';
```

- [ ] **Step 8: Provenance** — add `"NOTICE.md"` to the `files` array in `packages/emu/package.json`, then create `packages/emu/NOTICE.md` with a sentence ("The files under `src/` come from cschweda/trs80-emulator at commit 11612849c7e4dbbe76a45b38116486223fb05a9a (v1.6.0), moved into this layout in emu phase 0, under this license:") followed by upstream `LICENSE` lines 1–21 verbatim (the MIT text above its `---`). In `packages/emu/README.md`, replace the "Stub" sentence with what the package now holds, what stayed upstream (renderer, WebAudio, turbo, UI, assets), and a pointer to `NOTICE.md`.

- [ ] **Step 9: Run the tests and the suite**

Run: `pnpm -s vitest run packages/emu/test/import.test.js` → Expected: 2 passed.
Run: `pnpm -s test` → Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add packages/emu
git commit -m "emu0: extract the trs80-emulator core into packages/emu"
```

### Task 2: No platform globals in the core

**Files:**
- Modify: `packages/emu/src/cpu/z80cpu.js` (three `console.warn` calls), `packages/emu/src/devices/cassette.js` (four `console` calls), `packages/emu/src/machine/trs80-system.js` (constructor), `packages/emu/src/debug/state.js` (`toBase64`, `fromBase64`)
- Create: `packages/emu/test/platform-free.test.js`

**Interfaces:**
- Produces: `cpu.log` and `cassette.log`, each `(level: 'info'|'warn'|'error', text: string) => void`, a no-op by default; `new TRS80System({ romData, log })` hands `log` to `cpu` and `io.cassette`. `toBase64(bytes)` / `fromBase64(text)` keep their names and results.

- [ ] **Step 1: Write the failing tests**

```js
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { CassetteSystem, fromBase64, toBase64, Z80CPU } from '../src/index.js';

const src = fileURLToPath(new URL('../src/', import.meta.url));
const files = (dir) => readdirSync(dir).flatMap((e) => (statSync(join(dir, e)).isDirectory() ? files(join(dir, e)) : e.endsWith('.js') ? [join(dir, e)] : []));
/** Code without comments, so prose like "the window of time" does not count. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const GLOBALS = ['window', 'document', 'navigator', 'globalThis', 'self', 'requestAnimationFrame', 'cancelAnimationFrame', 'AudioContext', 'webkitAudioContext', 'localStorage', 'sessionStorage', 'fetch', 'XMLHttpRequest', 'addEventListener', 'removeEventListener', 'atob', 'btoa', 'Buffer', 'process', 'require', 'console', 'setTimeout', 'setInterval', 'performance', 'queueMicrotask'];
/** A bare global (not a property like `this.process`, not part of a longer name), or a clock or random source. */
const PLATFORM = new RegExp(`(?<![.\\w$])(?:${GLOBALS.join('|')})(?![\\w$])|\\bDate\\.now\\b|\\bnew Date\\b|\\bMath\\.random\\b`);

afterEach(() => vi.restoreAllMocks());

it('names no browser or Node global anywhere in src', () => {
  const hits = files(src).flatMap((f) => code(readFileSync(f, 'utf8')).split('\n').flatMap((line, i) => (PLATFORM.test(line) ? [`${f.slice(src.length)}:${i + 1}: ${line.trim()}`] : [])));
  expect(hits).toEqual([]);
});

it('reports an unimplemented opcode through the injected logger, not console', () => {
  const cpu = new Z80CPU();
  const mem = new Uint8Array(0x10000);
  mem.set([0xed, 0x00], 0); // ED 00: no ED case handles it
  cpu.readMemory = (a) => mem[a];
  cpu.writeMemory = (a, v) => { mem[a] = v; };
  cpu.readPort = () => 0xff;
  cpu.writePort = () => {};
  cpu.reset();
  const logged = [];
  cpu.log = (level, text) => logged.push([level, text]);
  const warn = vi.spyOn(console, 'warn');
  cpu.executeInstruction();
  expect(warn).not.toHaveBeenCalled();
  expect(logged).toEqual([['warn', expect.stringContaining('0xED 0x00')]]);
});

it('reports cassette activity through the injected logger, not console', () => {
  const tape = new CassetteSystem();
  const logged = [];
  tape.log = (level, text) => logged.push([level, text]);
  const log = vi.spyOn(console, 'log');
  tape.loadTape(Uint8Array.from([1, 2, 3]));
  expect(log).not.toHaveBeenCalled();
  expect(logged).toEqual([['info', 'Cassette loaded: 3 bytes']]);
});

it('encodes and decodes base64 itself', () => {
  for (const [bytes, text] of [[[], ''], [[0x4d], 'TQ=='], [[0x4d, 0x61], 'TWE='], [[0x4d, 0x61, 0x6e], 'TWFu'], [[0, 1, 2, 253, 254, 255], 'AAEC/f7/']]) {
    expect(toBase64(Uint8Array.from(bytes))).toBe(text);
    expect(Array.from(fromBase64(text))).toEqual(bytes);
  }
});
```

- [ ] **Step 2: Run and see them fail**

Run: `pnpm -s vitest run packages/emu/test/platform-free.test.js`
Expected: FAIL — the scan lists the `console`, `Buffer`, `atob`, and `btoa` lines; both logger tests see `console` called. (The base64 test may already pass through `Buffer`; it pins the results the rewrite must keep.)

- [ ] **Step 3: Inject the logger**
  - `z80cpu.js`: in the constructor add `this.log = () => {};` beside `this.strictMode = false;`; change each of the three `console.warn(` calls to `this.log("warn", ` with the same message argument.
  - `cassette.js`: in the constructor add `this.log = () => {};`; change `console.log(` (three calls) to `this.log("info", ` and `console.error("No tape loaded")` to `this.log("error", "No tape loaded")`.
  - `trs80-system.js`: change `constructor({ romData })` to `constructor({ romData, log })`, and after the four `new` lines add:

```js
    if (log !== undefined) {
      this.cpu.log = log;
      this.io.cassette.log = log;
    }
```

- [ ] **Step 4: Replace `toBase64` and `fromBase64` in `debug/state.js`** (from the comment `// Base64 helpers that work in both the browser and Node (vitest)` through the end of `fromBase64`):

```js
// Base64 without platform APIs, so the core runs anywhere (spec §2.1).
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function toBase64(bytes) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    text += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    text += i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=";
    text += i + 2 < bytes.length ? B64[n & 63] : "=";
  }
  return text;
}

export function fromBase64(text) {
  const clean = text.replace(/=+$/, "");
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let out = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error(`not base64: ${JSON.stringify(ch)}`);
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[out++] = (value >> bits) & 0xff;
    }
  }
  return bytes;
}
```

- [ ] **Step 5: Run the tests and the suite**

Run: `pnpm -s vitest run packages/emu/test/platform-free.test.js` → Expected: 4 passed. If the scan reports a word inside a string or a comment the stripper missed, fix that line or the stripper; never drop a name from `PLATFORM`.
Run: `pnpm -s test` → Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/emu
git commit -m "emu0: route core logging through an injected logger and drop platform base64"
```

### Task 3: Zero-DOM check in an empty `node:vm` context

**Files:**
- Create: `packages/emu/scripts/check-no-dom.mjs`, `packages/emu/test/no-dom.test.js`

**Interfaces:**
- Consumes: `TRS80System`, `serializeState`, `restoreState` from `src/index.js`.
- Produces: `node --experimental-vm-modules packages/emu/scripts/check-no-dom.mjs [entry]` exits 0 and prints `no platform globals: ok` on success; on any failure it exits 1 and prints the error. `entry` defaults to `packages/emu/src/index.js`.

- [ ] **Step 1: Write the failing test**

```js
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const script = fileURLToPath(new URL('../scripts/check-no-dom.mjs', import.meta.url));
const check = (...args) => spawnSync(process.execPath, ['--experimental-vm-modules', script, ...args], { encoding: 'utf8' });

it('links and runs the core in an empty vm context: no browser or Node global', () => {
  const r = check();
  expect(r.stdout + r.stderr).toContain('no platform globals: ok');
  expect(r.status).toBe(0);
});

it('fails on a module that touches a browser global, so the check is not vacuous', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fugloy-nodom-'));
  try {
    const bad = join(dir, 'bad.js');
    writeFileSync(bad, 'export const width = window.innerWidth;\n');
    const r = check(bad);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('window is not defined');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run and see it fail**

Run: `pnpm -s vitest run packages/emu/test/no-dom.test.js`
Expected: FAIL — the script does not exist.

- [ ] **Step 3: Write `packages/emu/scripts/check-no-dom.mjs`**

```js
/**
 * Spec §2.1: load the core inside node:vm with an empty context object, so any reference to a
 * browser or Node global throws. Links src/index.js (or the module given) as ES modules in that
 * context, then builds a Model III with a synthetic ROM and runs it there. Run with
 * `node --experimental-vm-modules`.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const entry = resolve(process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), '../src/index.js'));
const context = vm.createContext({});
const modules = new Map();

function load(path) {
  let m = modules.get(path);
  if (m === undefined) {
    m = new vm.SourceTextModule(readFileSync(path, 'utf8'), { context, identifier: path });
    modules.set(path, m);
  }
  return m;
}

function link(specifier, referencing) {
  if (!specifier.startsWith('.')) throw new Error(`${referencing.identifier} imports "${specifier}"; the core imports nothing from the platform`);
  return load(resolve(dirname(referencing.identifier), specifier));
}

try {
  const root = load(entry);
  await root.link(link);
  await root.evaluate();
  const { TRS80System, serializeState, restoreState } = root.namespace;
  if (typeof TRS80System === 'function') {
    // 0000 DI / LD SP,5000H / LD HL,3C00H / LD DE,0020H / LD B,5 / copy "READY" to the screen /
    // LD A,04H / OUT (0E0H),A / IM 1 / EI / JR $ ; 0038 IN A,(0ECH) / EI / RETI.
    const rom = new Uint8Array(0x3800);
    rom.set([0xf3, 0x31, 0x00, 0x50, 0x21, 0x00, 0x3c, 0x11, 0x20, 0x00, 0x06, 0x05, 0x1a, 0x77, 0x23, 0x13, 0x10, 0xfa, 0x3e, 0x04, 0xd3, 0xe0, 0xed, 0x56, 0xfb, 0x18, 0xfe], 0);
    rom.set([0x52, 0x45, 0x41, 0x44, 0x59], 0x20);
    rom.set([0xdb, 0xec, 0xfb, 0xed, 0x4d], 0x38);
    const sys = new TRS80System({ romData: rom });
    sys.runTStates(1_000_000);
    sys.keyboard.keyDown('a', 'check');
    sys.runTStates(70_000);
    sys.keyboard.keyUp('check');
    if (!sys.screenText()[0].startsWith('READY')) throw new Error(`the synthetic ROM did not reach the screen: ${JSON.stringify(sys.screenText()[0])}`);
    restoreState(sys, serializeState(sys));
    sys.runTStates(100_000);
  }
  console.log('no platform globals: ok');
} catch (e) {
  console.error(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
  process.exit(1);
}
```

- [ ] **Step 4: Run the test** — `pnpm -s vitest run packages/emu/test/no-dom.test.js` → Expected: 2 passed. If `restoreState(sys, serializeState(sys))` needs more than the machine (a mounted disk, a tape), read `debug/state.js` and pass what it requires; the call stays in.

- [ ] **Step 5: Commit**

```bash
git add packages/emu
git commit -m "emu0: check the core in an empty node:vm context"
```

### Task 4: Port the upstream tests that need no ROM

**Files:**
- Create: `packages/emu/test/unit/<name>.test.js` for each upstream `tests/unit/<name>-tests.js` in: `basic-program`, `cas-format`, `cassette-tape`, `cassette`, `cmd-format`, `cpu-flags`, `cpu-indexed`, `cpu-interrupt`, `cpu-opcode-coverage`, `cpu`, `cpu-xy-flags`, `disk-image`, `dmk`, `fdc`, `io`, `keyboard`, `memory`, `printer`, `write-track` (19 files, 321 static `it` calls upstream).
- Left out on purpose (ledger line each): `changelog`, `page`, `screen-layout`, `touch-input`, `ui` (web UI); `sound`, `video`, `turbo` (host code that stays upstream); `system` (needs the ROM: Task 5).

- [ ] **Step 1: Copy the files and rewrite their imports**

```bash
mkdir -p packages/emu/test/unit
for n in basic-program cas-format cassette-tape cassette cmd-format cpu-flags cpu-indexed cpu-interrupt cpu-opcode-coverage cpu cpu-xy-flags disk-image dmk fdc io keyboard memory printer write-track; do
  cp "$UP/tests/unit/$n-tests.js" "packages/emu/test/unit/$n.test.js"
done
```

In every copied file, rewrite each import of upstream source to the new layout. The paths are relative to `packages/emu/test/unit/`:

| Upstream (`../../src/…` or alias) | New |
| --- | --- |
| `src/core/z80cpu.js`, `@core/z80cpu.js` | `../../src/cpu/z80cpu.js` |
| `src/core/memory.js`, `@core/memory.js` | `../../src/machine/memory.js` |
| `src/core/io.js`, `@core/io.js` | `../../src/machine/io.js` |
| `src/system/trs80-system.js`, `@system/trs80-system.js` | `../../src/machine/trs80-system.js` |
| `src/system/state.js`, `@system/state.js` | `../../src/debug/state.js` |
| `src/peripherals/{keyboard,cassette,cassette-tape,fdc-wd1793,disk-image,printer}.js`, `@peripherals/…` | `../../src/devices/<same file>` |
| `src/peripherals/{cas-format,cmd-format}.js`, `@peripherals/…` | `../../src/loaders/<same file>` |

Each file must import what it uses from `vitest` (`describe`, `it`, `expect`, `beforeEach`, `vi`, …); add the names upstream took from Vitest's globals.

- [ ] **Step 2: Handle the four real-program tests in `cmd-format.test.js`.** Every `it` that reads a file through `programPath(...)` (`flysauc1.cmd`, `galaxy.cmd`, `nova-m3.cmd`, `opus1msg.cmd` from upstream `public/programs`) is deleted, with its title recorded in the ledger as "for emu phase 2 (real programs)"; remove `programPath` and the `node:fs`/`node:path` imports if nothing else uses them. Every `it` that builds its bytes in code stays.

- [ ] **Step 3: Run the ported tests**

Run: `pnpm -s vitest run packages/emu/test/unit` → Expected: every file passes. Record in the ledger "ported N tests in 19 files; M removed (titles)". A failure means a path or a missing Vitest import; never edit an assertion.

- [ ] **Step 4: Run the suite and commit**

Run: `pnpm -s test` → Expected: all pass.

```bash
git add packages/emu/test/unit
git commit -m "emu0: port the upstream unit tests that need no ROM"
```

### Task 5: The ROM from fugloy.mcp.json, boot to READY, and the ROM tests

**Files:**
- Create: `packages/emu/test/rom.js`, `packages/emu/test/rom.test.js`, `packages/emu/test/integration/boot.test.js`, `fugloy.mcp.example.json`
- Create (local only, gitignored): `fugloy.mcp.json`
- Modify: `.gitignore`
- Port (upstream → `packages/emu/test/…`): `tests/unit/system-tests.js` → `unit/system.test.js`; `tests/integration/{32col,cas-load,cassette-tape,disk-boot,library,printer,rom-boot,state}-tests.js` → `integration/<name>.test.js`
- Left out on purpose (ledger line each): `integration/{dmk-boot,dos-boot,two-drive}` (DOS disk images: emu phase 5), `games-library` (real programs: emu phase 2), `turbo` (host code).

**Interfaces:**
- Produces: `configPath(env = process.env): string | null` and `configuredRom(model = 'model3', config = configPath()): Uint8Array | null` from `packages/emu/test/rom.js`; `null` means skip.

- [ ] **Step 1: Write the failing tests**

`packages/emu/test/rom.test.js`:

```js
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { configuredRom } from './rom.js';

let dir;
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const config = (roms) => {
  dir = mkdtempSync(join(tmpdir(), 'fugloy-rom-'));
  const path = join(dir, 'fugloy.mcp.json');
  writeFileSync(path, JSON.stringify({ roms }));
  return path;
};

it('reads a ROM path relative to the config file, not the working directory', () => {
  const path = config({ model3: './roms/m3.rom' });
  mkdirSync(join(dir, 'roms'));
  writeFileSync(join(dir, 'roms', 'm3.rom'), new Uint8Array(14336).fill(0x11));
  const rom = configuredRom('model3', path);
  expect(rom?.length).toBe(14336);
  expect(rom?.[0]).toBe(0x11);
});

it('fails, rather than skipping, when the config names a ROM that is not there', () => {
  expect(() => configuredRom('model3', config({ model3: './missing.rom' }))).toThrow(/no such file/);
});

it('returns null with no config or no entry for the model, so the test skips', () => {
  expect(configuredRom('model3', null)).toBeNull();
  expect(configuredRom('model3', config({ model1: './l2.rom' }))).toBeNull();
});
```

`packages/emu/test/integration/boot.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { TRS80System } from '../../src/index.js';
import { configuredRom } from '../rom.js';

const rom = configuredRom('model3');
const screen = (sys) => sys.screenText().join('\n');

/** Runs until `ready()` holds, in steps of `step` T-states; returns the T-state count when it does. */
function runUntil(sys, ready, budget, step = 20_000) {
  const start = sys.cpu.cycles;
  while (!ready()) {
    if (sys.cpu.cycles - start > budget) throw new Error(`not reached within ${budget} T-states:\n${screen(sys)}`);
    sys.runTStates(step);
  }
  return sys.cpu.cycles;
}

/** The cassette BASIC boot, driven by what the screen shows: Cass? ENTER, Memory Size? ENTER, READY. */
function boot(sys) {
  runUntil(sys, () => screen(sys).includes('Cass?'), 4_000_000);
  sys.typeText('\n');
  runUntil(sys, () => screen(sys).includes('Memory Size'), 4_000_000);
  sys.typeText('\n');
  return runUntil(sys, () => sys.screenText().some((line) => line.startsWith('READY')), 8_000_000);
}

describe.skipIf(rom === null)('the Model III ROM from fugloy.mcp.json', () => {
  it('boots to READY in Node with no DOM stubs', () => {
    expect(globalThis.window).toBeUndefined();
    expect(globalThis.document).toBeUndefined();
    const sys = new TRS80System({ romData: rom });
    boot(sys);
    expect(sys.screenText().some((line) => line.startsWith('READY'))).toBe(true);
  });

  it('boots the same way twice: READY at the same T-state, the same screen', () => {
    const a = new TRS80System({ romData: rom });
    const b = new TRS80System({ romData: rom });
    expect(boot(a)).toBe(boot(b));
    expect(a.screenText()).toEqual(b.screenText());
  });
});
```

- [ ] **Step 2: Run and see them fail**

Run: `pnpm -s vitest run packages/emu/test/rom.test.js packages/emu/test/integration/boot.test.js`
Expected: FAIL — `./rom.js` does not exist.

- [ ] **Step 3: Write `packages/emu/test/rom.js`**

```js
/**
 * The ROM a test boots, from the `roms` table of fugloy.mcp.json (docs/fugloy-mcp-spec.md §3):
 * $FUGLOY_CONFIG, else fugloy.mcp.json at the repository root, else ~/.config/fugloy/fugloy.mcp.json.
 * A relative path in the file is relative to the file's own folder. No config, or no entry for
 * the model: null, and the test skips. An entry naming a missing file is an error, never a skip.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));

export function configPath(env = process.env) {
  const candidates = [env.FUGLOY_CONFIG, join(repo, 'fugloy.mcp.json'), join(homedir(), '.config', 'fugloy', 'fugloy.mcp.json')];
  return candidates.find((p) => p !== undefined && p !== '' && existsSync(p)) ?? null;
}

export function configuredRom(model = 'model3', config = configPath()) {
  if (config === null) return null;
  const entry = (JSON.parse(readFileSync(config, 'utf8')).roms ?? {})[model];
  if (entry === undefined) return null;
  const path = isAbsolute(entry) ? entry : resolve(dirname(config), entry);
  if (!existsSync(path)) throw new Error(`${config} names ${path} as roms.${model}, and there is no such file`);
  return new Uint8Array(readFileSync(path));
}
```

- [ ] **Step 4: Configure this machine** — add `fugloy.mcp.json` to `.gitignore` under the ROM lines, then write both files:

`fugloy.mcp.example.json` (committed; the format of `docs/fugloy-mcp-spec.md` §3):

```json
{
  "roms": { "model1": "./fixtures/real/level2-model1.rom", "model3": "./fixtures/real/model3.rom" },
  "defaultModel": 3,
  "fixtures": "./fixtures/real",
  "limits": { "runSecondsEmulated": 10, "outputBytes": 4096, "traceDepth": 2000 }
}
```

`fugloy.mcp.json` (local; `cp fugloy.mcp.example.json fugloy.mcp.json`; `fixtures/real/model3.rom` is the 14,336-byte Model III ROM already on this machine). `git status` must not list it.

- [ ] **Step 5: Run the new tests** — `pnpm -s vitest run packages/emu/test/rom.test.js packages/emu/test/integration/boot.test.js` → Expected: 5 passed (3 config tests, 2 boot tests; with the local config present, the boot tests run, not skip).

- [ ] **Step 6: Port the ROM-dependent upstream tests** — copy as in Task 4 (`system-tests.js` → `unit/system.test.js`; the eight integration files → `integration/<name>.test.js`), with the same import table (paths from `test/integration/` are the same depth as from `test/unit/`), plus:
  - Replace each read of `public/assets/model3.rom` (`readFileSync(ROM_PATH)` or `readFileSync(path.resolve(process.cwd(), …))`) with `const rom = configuredRom('model3');` from `../rom.js`, and wrap the file's top-level `describe` in `describe.skipIf(rom === null)` (or add `.skipIf(rom === null)` to it).
  - `unit/system.test.js`: delete the `require()` calls (upstream lines 120–121) in favor of ESM imports, and delete the wall-clock speed assertion (upstream lines 103–113), naming it in the ledger.
  - Integration tests that set Vitest's `environment: "jsdom"` through a pragma: remove the pragma (the root runs Node).

- [ ] **Step 7: Run everything** — `pnpm -s vitest run packages/emu` → Expected: all pass, ROM tests included. Then hide the config (`FUGLOY_CONFIG=` is not enough; run `mv fugloy.mcp.json "${TMPDIR:-/tmp}/fugloy.mcp.json.bak" && pnpm -s vitest run packages/emu; mv "${TMPDIR:-/tmp}/fugloy.mcp.json.bak" fugloy.mcp.json`) → Expected: all pass with the ROM tests skipped, as in CI. Record both counts in the ledger.

- [ ] **Step 8: Commit**

```bash
git add .gitignore fugloy.mcp.example.json packages/emu/test
git commit -m "emu0: boot the Model III ROM from fugloy.mcp.json to READY in Node"
```

### Task 6: Docs and status

**Files:**
- Modify: `docs/fugloy-emu-spec.md` (§1, §3, §12), `docs/Fugloy-Project-Plan.md` (Part 2 step 3), `CLAUDE.md`, `README.md`, `CHANGELOG.md`, `packages/emu/README.md`

- [ ] **Step 1: Correct the spec's provenance.** §1, the sentence beginning "The existing `cschweda/trs80-emulator` (derived from trsjs.48k.ca)": it is the author's own MIT code; trsjs.48k.ca, George Phillips's site, supplied some of its sample games, not code. Say it became `packages/emu` in phase 0 from commit `11612849`. §12: check the license question with that answer and a pointer to `packages/emu/NOTICE.md`. §3: add one line that phase 0 keeps upstream's file names inside the spec's folders (`cpu/z80cpu.js`, `machine/trs80-system.js`, …) and that phase 1 may split the CPU.

- [ ] **Step 2: Correct the project plan.** Part 2, step 3: "trsjs (Peter Phillips, derived from trs80gp)" becomes "trsjs (George Phillips, derived from his trs80gp)".

- [ ] **Step 3: Status.** CLAUDE.md: "Current phase" names emu phase 0 as done and emu phase 1 (ZEXALL) as next; the Roadmap's emu item marks phase 0 done. README: the status paragraph's "Next is the emulator's phase 0…" becomes what phase 0 delivered and that phase 1 is next, and the `packages/emu` row of the package table describes the extracted core instead of a stub. CHANGELOG `[Unreleased]` → `### Added`: one bullet for `@fugloy/emu` (the extracted core, the platform-free logger and base64, the `node:vm` check, the boot test via `fugloy.mcp.json`, the ported tests and counts).

- [ ] **Step 4: Run the suite and commit**

Run: `pnpm -s typecheck && pnpm -s test` → Expected: both pass.

```bash
git add docs CLAUDE.md README.md CHANGELOG.md packages/emu/README.md
git commit -m "emu0: record emu phase 0 in the spec, plan, roadmap, and changelog"
```
