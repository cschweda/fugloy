/**
 * The server's config, `fugloy.mcp.json` (docs/fugloy-mcp-spec.md §3): `$FUGLOY_CONFIG` (which
 * must name a file when set), else `fugloy.mcp.json` in the working directory, else
 * `~/.config/fugloy/fugloy.mcp.json`, else the defaults. Paths in the file are relative to the
 * file's own folder. A broken file throws one sentence naming it, never a stack.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** The guardrails of MCP spec §7; `limits` in the config overrides any of them. */
export const DEFAULT_LIMITS = Object.freeze({
  runSecondsEmulated: 10,
  runSecondsWall: 5,
  outputBytes: 8192,
  traceDepth: 2000,
  stepMax: 100,
  peekMax: 1024,
});

/**
 * @typedef {{
 *   roms: Record<string, string>,
 *   defaultModel: 3,
 *   fixtures?: string,
 *   limits: { runSecondsEmulated: number, runSecondsWall: number, outputBytes: number, traceDepth: number, stepMax: number, peekMax: number },
 *   source: string | null,
 * }} Config
 */

/**
 * Find and read the config.
 * @param {{ cwd: string, env: Record<string, string | undefined>, home: string }} where
 * @returns {Config}
 */
export function loadConfig({ cwd, env, home }) {
  const path = findConfig({ cwd, env, home });
  if (path === null) return { roms: {}, defaultModel: 3, limits: { ...DEFAULT_LIMITS }, source: null };
  return parseConfig(readFileSync(path, 'utf8'), path);
}

/** The config file's path, or null when there is none. */
function findConfig({ cwd, env, home }) {
  const named = env.FUGLOY_CONFIG;
  // A FUGLOY_CONFIG that is set wins even when it names nothing, so a typo fails instead of falling back.
  if (named !== undefined && named !== '') {
    const path = resolve(cwd, named);
    if (!existsSync(path)) throw new Error(`FUGLOY_CONFIG names ${path}, and there is no such file.`);
    return path;
  }
  return [join(cwd, 'fugloy.mcp.json'), join(home, '.config', 'fugloy', 'fugloy.mcp.json')].find((p) => existsSync(p)) ?? null;
}

/**
 * Check and resolve the text of the config file at `path`.
 * @param {string} text
 * @param {string} path
 * @returns {Config}
 */
function parseConfig(text, path) {
  const fail = (/** @type {string} */ why) => new Error(`The config file ${path} ${why}.`);
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw fail(`is not valid JSON (${/** @type {Error} */ (err).message.replace(/\.$/, '')})`);
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw fail('must hold a JSON object');
  const base = dirname(path);

  /** @type {Record<string, string>} */
  const roms = {};
  if (raw.roms !== undefined) {
    if (raw.roms === null || typeof raw.roms !== 'object' || Array.isArray(raw.roms)) throw fail('has a roms entry that is not an object of paths');
    for (const [model, rom] of Object.entries(raw.roms)) {
      if (typeof rom !== 'string' || rom === '') throw fail(`says roms.${model} must be a path, and it is ${JSON.stringify(rom)}`);
      roms[model] = resolve(base, rom);
    }
  }

  if (raw.defaultModel !== undefined && raw.defaultModel !== 3) {
    throw fail(`sets defaultModel to ${JSON.stringify(raw.defaultModel)}, and only the Model III (3) exists until emu phase 6 adds the Model I and the Model 4`);
  }

  if (raw.fixtures !== undefined && (typeof raw.fixtures !== 'string' || raw.fixtures === '')) {
    throw fail(`says fixtures must be a path, and it is ${JSON.stringify(raw.fixtures)}`);
  }

  const limits = { ...DEFAULT_LIMITS };
  if (raw.limits !== undefined) {
    if (raw.limits === null || typeof raw.limits !== 'object' || Array.isArray(raw.limits)) throw fail('has a limits entry that is not an object');
    for (const [key, value] of Object.entries(raw.limits)) {
      if (!Object.hasOwn(DEFAULT_LIMITS, key)) {
        throw fail(`names limits.${key}, and ${key} is not a limit (the limits are ${Object.keys(DEFAULT_LIMITS).join(', ')})`);
      }
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw fail(`says limits.${key} must be a positive number, and it is ${JSON.stringify(value)}`);
      }
      limits[/** @type {keyof typeof DEFAULT_LIMITS} */ (key)] = value;
    }
  }

  return {
    roms,
    defaultModel: 3,
    ...(raw.fixtures !== undefined ? { fixtures: resolve(base, raw.fixtures) } : {}),
    limits,
    source: path,
  };
}
