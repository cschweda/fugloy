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
