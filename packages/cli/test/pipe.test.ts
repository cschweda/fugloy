/** The real process, from source: what a shell pipeline sees. */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const main = fileURLToPath(new URL('../src/main.ts', import.meta.url));

it('ends quietly when the reader closes the pipe early, as `fugloy big.bin --base 8000 | head` does', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fugloy-pipe-'));
  try {
    const file = join(dir, 'big.bin');
    writeFileSync(file, new Uint8Array(16384)); // 16K of NOPs lists to far more than a pipe buffer holds
    const child = spawn(process.execPath, ['--conditions=source', '--import', 'tsx', main, file, '--base', '8000'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    const closed = new Promise<number | null>((resolve) => child.on('close', (code) => resolve(code)));
    await new Promise<void>((resolve) => child.stdout.once('data', () => { child.stdout.destroy(); resolve(); }));
    const code = await closed;
    expect(stderr).toBe('');
    expect(code).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

it('keeps its exit code when the reader of stderr closes early, as `fugloy x.cmd --hints h 2>&1 | head` can', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fugloy-pipe-'));
  try {
    const hints = join(dir, 'bad.hints');
    writeFileSync(hints, `fugloy-hints 1\n${'not a directive\n'.repeat(20_000)}`); // 20,000 errors: far more than a pipe holds
    const program = fileURLToPath(new URL('../../../fixtures/synthetic/cmd/small-block.cmd', import.meta.url));
    const child = spawn(process.execPath, ['--conditions=source', '--import', 'tsx', main, program, '--hints', hints], { stdio: ['ignore', 'ignore', 'pipe'] });
    const closed = new Promise<number | null>((resolve) => child.on('close', (code) => resolve(code)));
    await new Promise<void>((resolve) => child.stderr.once('data', () => { child.stderr.destroy(); resolve(); }));
    expect(await closed).toBe(2); // a hint-file error, not a crash
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
