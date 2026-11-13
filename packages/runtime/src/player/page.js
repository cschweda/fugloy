/**
 * The player's page (M2): thin glue over the DOM. It reads `manifest.json` (written by @fugloy/recomp's
 * `pnpm play`), shows the game's name, authors, rights and keys, starts the worker (worker.js) on the port
 * with two pieces of shared memory (the key rows and the worker's frame counter), draws each frame the
 * worker posts on the canvas with @fugloy/runtime/screen, turns key events on the canvas into matrix rows
 * (keys.js, KeyTracker), and plays each frame's sound (sound.js) through WebAudio from the first key or
 * click (a browser lets a page make sound only after a gesture). The logic is in frame.js, sound.js and
 * keys.js, which are tested without a browser.
 *
 * Shared memory needs a cross-origin isolated page: the server must send `Cross-Origin-Opener-Policy:
 * same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. Without them the page says so and stops.
 *
 * `globalThis.fugloyPlayer` holds a few counts for a person or a test watching the page: the last frame
 * posted, its T-state and its video RAM, and the audio buffers scheduled, dropped, and with a change of level
 * in them (a sound).
 */
import { modelOf } from '../model.js';
import { renderScreen, screenOf, screenSize, tubeAspect, tubeFit } from '../screen.js';
import { KeyTracker } from './keys.js';
import { createAudioSchedule, samples } from './sound.js';

/** The sound's volume: the cassette port's full swing is loud, so a modest fraction of it. */
const VOLUME = 0.12;
/** A high-pass below hearing takes out the level a port leaves standing, so a held level never clicks. */
const DC_BLOCK_HZ = 20;

const stats = { frame: 0, cycles: 0, video: /** @type {Uint8Array | null} */ (null), buffers: 0, dropped: 0, loud: 0, audio: false };
/** @type {any} */ (globalThis).fugloyPlayer = stats;

/** @param {string} id */
const byId = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

async function main() {
  const status = byId('status');
  const manifest = await (await fetch('manifest.json')).json();
  document.title = `${manifest.title} — Fugløy`;
  byId('title').textContent = manifest.title;
  byId('authors').textContent = manifest.authors ?? '';
  byId('rights').textContent = manifest.rights ?? '';
  const keyList = byId('keys');
  for (const [key, does] of manifest.keys) {
    const dt = document.createElement('dt');
    dt.textContent = key;
    const dd = document.createElement('dd');
    dd.textContent = does;
    keyList.append(dt, dd);
  }

  if (!globalThis.crossOriginIsolated) {
    status.textContent =
      'This page is not cross-origin isolated, so it cannot share memory with the worker that runs the game. Serve it with Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp (pnpm play does).';
    return;
  }

  const model = modelOf(manifest.model);
  const keyMemory = new SharedArrayBuffer(8);
  const counterMemory = new SharedArrayBuffer(4);
  const counter = new Int32Array(counterMemory);
  const tracker = new KeyTracker(new Uint8Array(keyMemory), () => Atomics.load(counter, 0));

  // ---- the screen
  const canvas = /** @type {HTMLCanvasElement} */ (byId('screen'));
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  /** @type {import('./frame.js').FrameMessage | null} */
  let latest = null;
  /** @type {import('./frame.js').FrameMessage | null} */
  let drawn = null;
  /** @type {ImageData | null} */
  let image = null;
  /** @param {number} mode */
  const viewOf = (mode) => screenOf(/** @type {any} */ ({ model: manifest.model, modeRegister: mode, columns32: (mode & model.modeBit) !== 0 }));
  const fit = () => {
    const view = viewOf(latest?.mode ?? 0);
    const { height } = screenSize(view);
    const box = /** @type {HTMLElement} */ (canvas.parentElement);
    const size = tubeFit(height, tubeAspect(view.font), box.clientWidth, Math.max(height, window.innerHeight * 0.7));
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
  };
  const draw = () => {
    if (latest !== null && latest !== drawn) {
      const view = viewOf(latest.mode);
      const { width, height } = screenSize(view);
      if (image === null || image.width !== width || image.height !== height) {
        canvas.width = width;
        canvas.height = height;
        image = ctx.createImageData(width, height);
        fit();
      }
      if (renderScreen(latest.video, view, image.data, width)) ctx.putImageData(image, 0, 0);
      drawn = latest;
    }
    requestAnimationFrame(draw);
  };
  window.addEventListener('resize', fit);
  fit();
  requestAnimationFrame(draw);

  // ---- the sound
  /** @type {{ ctx: AudioContext, input: AudioNode, schedule: ReturnType<typeof createAudioSchedule> } | null} */
  let audio = null;
  /** The last write to port $FF of the frames before: the level the next frame starts at. */
  let lastWrite = /** @type {{ t: number, v: number } | null} */ (null);
  const startAudio = () => {
    if (audio !== null) return;
    const ctx = new AudioContext();
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = DC_BLOCK_HZ;
    const gain = ctx.createGain();
    gain.gain.value = VOLUME;
    filter.connect(gain);
    gain.connect(ctx.destination);
    void ctx.resume();
    audio = { ctx, input: filter, schedule: createAudioSchedule() };
    stats.audio = true;
    status.textContent = '';
  };
  /** @param {import('./frame.js').FrameMessage} m */
  const sound = (m) => {
    const records = lastWrite === null ? m.sound : [lastWrite, ...m.sound];
    if (m.sound.length > 0) lastWrite = m.sound[m.sound.length - 1];
    if (audio === null) return;
    const rate = audio.ctx.sampleRate;
    const wave = samples(records, m.from, m.to, model.clockHz, rate);
    if (wave.length === 0) return;
    const at = audio.schedule.next(audio.ctx.currentTime, wave.length / rate);
    if (at < 0) {
      stats.dropped++;
      return;
    }
    const buffer = audio.ctx.createBuffer(1, wave.length, rate);
    buffer.copyToChannel(wave, 0);
    const source = audio.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(audio.input);
    source.start(at);
    stats.buffers++;
    // A buffer is heard only where its level changes: a level held still is taken out by the high-pass
    if (wave.some((v, i) => i > 0 && v !== wave[i - 1])) stats.loud++;
  };

  // ---- the keys, on the canvas
  canvas.addEventListener('keydown', (e) => {
    startAudio();
    if (tracker.down(e)) e.preventDefault();
  });
  canvas.addEventListener('keyup', (e) => {
    if (tracker.up(e)) e.preventDefault();
  });
  canvas.addEventListener('blur', () => tracker.blur());
  canvas.addEventListener('pointerdown', () => {
    canvas.focus();
    startAudio();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') tracker.blur();
  });

  // ---- the worker
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (event) => {
    const m = event.data;
    if (m.type === 'frame') {
      latest = m;
      stats.frame = m.frame;
      stats.cycles = m.cycles;
      stats.video = m.video;
      tracker.update();
      sound(m);
    } else if (m.type === 'error') {
      status.textContent = `The port stopped: ${m.message}`;
    } else if (m.type === 'returned') {
      status.textContent = 'The program returned from its entry, and the port has stopped.';
    }
  };
  worker.onerror = (e) => {
    status.textContent = `The worker could not run the port: ${e.message}`;
  };
  worker.postMessage({ module: new URL(manifest.module, document.baseURI).href, keys: keyMemory, counter: counterMemory, start: manifest.start });
  status.textContent = 'Click the screen or press a key to play; the sound starts then.';
  canvas.focus();
}

main().catch((e) => {
  byId('status').textContent = `The player could not start: ${e instanceof Error ? e.message : String(e)}`;
});
