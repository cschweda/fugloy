<script setup lang="ts">
// Run ▶ (plan 5B, Task 4): the model the source is written for, Run (Ctrl/⌘+Enter anywhere in
// the workbench), Stop, Show in Listing, what the run says, the TRS-80's screen, and the ROM for
// the model, added from a file or dropped on the tab and kept in this browser only. The page
// loads this component lazily, with emu.
//
// 5C: Pause/Continue, Step, Step Over, Run to Here and Follow in the bar, each with its key in its
// title (the keys themselves are utils/running/debug-keys, installed here and by Source ✎); the
// registers beside the screen; the source's breakpoints under it. The run message stays quiet for
// a sentence the announcer already says (one voice, and steps debounced). The checkboxes use
// :checked and @change, not v-model: vModelCheckbox would join Vue's shared chunk on the first screen.
// The listing follows the run through utils/running/listing-style (one <style>, keyed on data-addr),
// installed here; `scrollListing` is the page's scrollTo, which moves neither the cursor nor focus.
//
// 5D: the TRS-80 first. Top to bottom: the bar (Model, Run ▶, Stop, Show in Listing), the message,
// the screen, the machine row (Power, Reset, Pause/Continue, and 6A's Full screen), Programs to try, the Debugger
// disclosure (the step controls, Follow, the registers, the breakpoints, Screen text), the ROM.
// The Debugger opens by itself when a source Run attaches the debugger and when a run pauses; the
// user's toggle otherwise stands, and the debug keys work with it closed. The first time the tab
// shows, with a ROM for the model and nothing run or said yet, the machine is turned on; the screen
// takes the focus then only if the focus has not moved meanwhile and is not on a tab or in Source ✎
// (a keyboard user arrowing through the tabs, or one already typing, keeps it). The screen takes the
// focus after Power on and Reset while the tab shows, and when this tab's Run ▶ or a Program to try
// starts a program (Ctrl/⌘+Enter elsewhere leaves it). With no ROM for the model and
// no machine, the tube says so in its own font.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import TrsScreen from './TrsScreen.vue';
import ScreenText from './ScreenText.vue';
import RegistersPanel from './RegistersPanel.vue';
import BreakpointList from './BreakpointList.vue';
import ProgramsToTry from './ProgramsToTry.vue';
import type { ExampleId } from '~/data/examples';
import type { DebugKeyOptions } from '~/utils/running/debug-keys';
import { announcing, speakAnnouncements } from '~/utils/running/announce';
import { installListingFollow } from '~/utils/running/listing-style';
import { useRoms } from '~/composables/useRoms';
import type { Run } from '~/composables/useRun';
import type { Sources } from '~/composables/useSources';
import { MODEL_NAMES } from '~/utils/emulator/rom-ids';
import type { ModelId } from '~/utils/store';

// The page hands over its Run and sources, so this lazy chunk imports none of the first screen's modules.
const props = defineProps<{
  run: Run;
  sources: Sources;
  /** Brings a listing row into view (the page's scrollTo). */
  scrollListing?: (addr: number) => void;
  /** Run ▶ is the right tab showing. */
  shown?: boolean;
}>();
const run = props.run;
const sources = props.sources;
const debug = run.debug;
const roms = useRoms();
const screen = ref<InstanceType<typeof TrsScreen> | null>(null);
const screenText = ref<InstanceType<typeof ScreenText> | null>(null);
/** Whether the TRS-80's screen is in full screen (6A). */
const screenFull = computed(() => screen.value?.fullscreen ?? false);
const picker = ref<HTMLInputElement | null>(null);
const romMessage = ref<string | null>(null);
const romProblem = ref(false);
const over = ref(false);
const isMac = ref(false);

const MODELS: readonly ModelId[] = [1, 3, 4];
const model = computed<ModelId>(() => sources.current.value?.model ?? 3);
const machine = computed(() => run.runner.value?.machine ?? null);
/** A program is under way: running, or paused (5C) at a breakpoint, a step, or Pause. Stop ends either. */
const running = computed(() => run.state.value === 'running' || run.state.value === 'paused');
const rom = computed(() => roms.info(model.value));
/** No machine and no ROM for the model: the tube says so (the stub ROM has no BASIC to turn on). */
const notice = computed(() => (machine.value === null && rom.value === null ? ['NO ROM FOR THE ' + MODEL_NAMES[model.value].toUpperCase(), '', 'ADD YOUR ROM BELOW TO TURN IT ON.'] : null));
/** The Debugger disclosure: its own open state is the user's, which a source Run and a pause set open. */
const debuggerBox = ref<HTMLDetailsElement | null>(null);
function openDebugger(): void {
  if (debuggerBox.value !== null) debuggerBox.value.open = true;
}
/** The runner pauses by itself: the machine on with no program, or a Program to try (neither has the debugger). */
const programless = computed(() => run.power.value !== 'off' && debug.mode.value === 'idle');
const runKey = computed(() => (isMac.value ? '⌘+Enter' : 'Ctrl+Enter'));
/** Stepping needs a program running or paused. */
const underWay = computed(() => debug.mode.value === 'running' || debug.mode.value === 'paused');
const paused = computed(() => debug.mode.value === 'paused');
/** Pause/Continue, in the machine row: the debugger's for a source Run, the runner's otherwise. */
const canPause = computed(() => underWay.value || programless.value);
const machinePaused = computed(() => (programless.value ? run.state.value === 'paused' : paused.value));
/** The debug keys F5 and F6 drive a source Run only; the machine on its own has the button alone. */
const pauseTitle = computed(() => (programless.value ? (machinePaused.value ? 'Continue the TRS-80' : 'Pause the TRS-80') : machinePaused.value ? 'Continue running (F5)' : 'Pause the program (F6)'));
const hereKey = computed(() => (isMac.value ? '⌘+F10' : 'Ctrl+F10'));
/** The run message says what the announcer, while it is listening, already says: not a second live region for it. */
const quiet = computed(() => announcing.value && run.message.value !== null && debug.announcement.value?.text === run.message.value);

/** In utils/lazy's loadFailed words, with reloading as the next step (lazy code does not import utils/lazy). */
const KEYS_FAILED = 'The debugger could not be loaded: the connection may have dropped, or the site was updated since this page opened. Reload the page.';
const KEYS_LOADING = 'The debugger is still loading. Press Run to Here again in a moment.';
/** A sentence from a debug control that cannot act. */
function sayProblem(text: string): void {
  run.message.value = text;
  run.problem.value = true;
}
function pauseOrContinue(): void {
  if (programless.value) {
    if (run.state.value === 'paused') run.continueMachine();
    else run.pauseMachine();
  } else if (paused.value) debug.continue();
  else debug.pause();
}

function focusScreen(): void {
  screen.value?.focus();
}
/** Power on (or Reset): the screen takes the focus once the machine is on, if the tab still shows (and `mayFocus` agrees). */
async function turnOn(how: 'on' | 'reset', mayFocus: () => boolean = () => true): Promise<void> {
  await (how === 'on' ? run.powerOn() : run.reset());
  if (props.shown !== false && run.power.value === 'on' && mayFocus()) focusScreen();
}
/** The focus is where it was (`from`), and not on a tab or in the editor. */
function focusStayed(from: Element | null): boolean {
  const now = document.activeElement;
  return now === from && now?.closest('[role="tab"], .cm-editor') == null;
}
function togglePower(): void {
  if (run.power.value === 'off') void turnOn('on');
  else run.powerOff();
}
/** This tab's Run ▶: the screen takes the focus when the program starts. */
async function runHere(): Promise<void> {
  await run.run();
  if (run.power.value === 'program') focusScreen();
}
async function tryProgram(id: ExampleId): Promise<void> {
  await run.runExample(id);
  if (run.power.value === 'program') focusScreen();
}

// A source Run attaching the debugger (a new runner, or the text back to the one it ran) opens the Debugger, and so does a pause.
watch([() => run.runner.value, () => debug.live.value] as const, ([r, live], [oldR, oldLive]) => {
  if (live && debug.mode.value !== 'idle' && (r !== oldR || !oldLive)) openDebugger();
});
watch(
  () => debug.mode.value,
  (m) => {
    if (m === 'paused') openDebugger();
  },
);

/** The first time the tab shows, the machine is turned on: with a ROM for the model, and nothing run, loading or said yet. */
let firstShow = true;
async function onShown(): Promise<void> {
  if (!firstShow) return;
  firstShow = false;
  const from = document.activeElement;
  await Promise.all([roms.start(), sources.start()]);
  if (gone || !props.shown || run.busy.value || run.power.value !== 'off' || run.message.value !== null || !roms.have(model.value)) return;
  await turnOn('on', () => focusStayed(from));
}
watch(
  () => props.shown,
  (s) => {
    if (s) void onShown();
  },
);

function setModel(e: Event): void {
  const src = sources.current.value;
  if (src === null) return;
  sources.update(src.id, { model: Number((e.target as HTMLSelectElement).value) as ModelId });
}

async function addRom(file: File): Promise<void> {
  romMessage.value = null;
  const r = await roms.add(file, undefined, model.value);
  romProblem.value = !r.ok;
  romMessage.value = r.ok ? `${file.name} is kept in this browser as the ${MODEL_NAMES[r.model]} ROM. Press Power on to turn it on, or Run ▶ to run your source on it.` : r.reason;
}

function onPick(e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file !== undefined) void addRom(file);
  input.value = '';
}

const hasFiles = (e: DragEvent): boolean => e.dataTransfer?.types.includes('Files') ?? false;
function onDragOver(e: DragEvent): void {
  if (!hasFiles(e)) return;
  e.preventDefault();
  over.value = true;
}
/** A file dropped on the tab is a ROM, not a program to open: the page's own drop handler never sees it. */
function onDrop(e: DragEvent): void {
  over.value = false;
  const file = e.dataTransfer?.files[0];
  if (file === undefined) return;
  e.preventDefault();
  e.stopPropagation();
  void addRom(file);
}

async function removeRom(): Promise<void> {
  const m = model.value;
  try {
    await roms.remove(m);
    romProblem.value = false;
    romMessage.value = `The ${MODEL_NAMES[m]} ROM is removed from this browser.`;
  } catch (err) {
    romProblem.value = true;
    // useRoms words its own failures with a next step; anything else gets one.
    const msg = err instanceof Error ? err.message : String(err);
    romMessage.value = /try again|reload/i.test(msg) ? msg : `The ${MODEL_NAMES[m]} ROM could not be removed (${msg.replace(/\.$/, '')}). Reload the page and try again.`;
  }
}

// Draw each frame the runner runs (TrsScreen draws by itself when the machine changes).
let unsubscribe: (() => void) | null = null;
// The debug keys load as a chunk of their own (so utils/running/ is a lazy root the manifest names).
let keys: typeof import('~/utils/running/debug-keys') | null = null;
let keysState: 'loading' | 'ready' | 'failed' = 'loading';
let uninstallKeys: (() => void) | null = null;
let unspeak: (() => void) | null = null;
let unfollow: (() => void) | null = null;
let gone = false;
const keyOptions: DebugKeyOptions = { runNow: () => void run.run(), stop: () => run.stop(), say: sayProblem };
function runToHere(): void {
  if (keys === null) return sayProblem(keysState === 'failed' ? KEYS_FAILED : KEYS_LOADING);
  keys.runToHere(debug, keyOptions);
}
onMounted(() => {
  isMac.value = /Mac|iPhone|iPad/.test(navigator.platform);
  void roms.start();
  void sources.start();
  unsubscribe = run.onFrame(() => {
    screen.value?.draw();
    screenText.value?.refresh();
  });
  // A Run started before this tab first mounted (Ctrl/⌘+Enter from Source ✎) opens it too.
  if (debug.live.value && debug.mode.value !== 'idle') openDebugger();
  if (props.shown) void onShown();
  // The announcer is in this chunk: pauses are spoken even if the keys' chunk never arrives.
  unspeak = speakAnnouncements(debug);
  unfollow = installListingFollow(debug, (addr) => props.scrollListing?.(addr));
  import('~/utils/running/debug-keys').then(
    (m) => {
      if (gone) return;
      keys = m;
      keysState = 'ready';
      uninstallKeys = m.installDebugKeys(debug, keyOptions);
    },
    () => {
      if (gone) return;
      keysState = 'failed';
      sayProblem(KEYS_FAILED);
    },
  );
});
onBeforeUnmount(() => {
  gone = true;
  unsubscribe?.();
  uninstallKeys?.();
  unspeak?.();
  unfollow?.();
});

defineExpose({ focusScreen });
</script>

<template>
  <section class="fg-run" :class="{ 'fg-run-over': over }" aria-label="Run" data-testid="run-tab" @dragover="onDragOver" @dragleave="over = false" @drop="onDrop">
    <div class="fg-run-bar" role="group" aria-label="Run controls">
      <label for="run-model" class="fg-muted">Model</label>
      <select id="run-model" class="fg-input" data-testid="run-model" :value="model" :disabled="sources.current.value === null" @change="setModel">
        <option v-for="m in MODELS" :key="m" :value="m">{{ MODEL_NAMES[m] }}</option>
      </select>
      <button type="button" class="fg-button fg-button-primary" data-testid="run-run" :aria-busy="run.busy.value" :title="`Assemble and run (${runKey})`" @click="runHere">Run ▶</button>
      <button type="button" class="fg-button" data-testid="run-stop" :disabled="!running && !run.busy.value" @click="run.stop()">Stop</button>
      <button type="button" class="fg-button" data-testid="run-show-listing" :disabled="!run.listable.value" @click="run.showInListing()">Show in Listing</button>
    </div>
    <p class="fg-run-message" :class="{ 'fg-run-problem': run.problem.value }" role="status" :aria-live="quiet ? 'off' : 'polite'" data-testid="run-message">
      {{ run.message.value ?? `Press Run ▶ or ${runKey} to assemble the source and run it on a fresh ${MODEL_NAMES[model]}.` }}
    </p>
    <div class="fg-run-screen"><TrsScreen ref="screen" :machine="machine" :running="running" :notice="notice" :model="model" /></div>
    <div class="fg-run-machine-row" role="group" aria-label="TRS-80" data-testid="machine-row">
      <button type="button" class="fg-button" data-testid="machine-power" @click="togglePower">{{ run.power.value === 'off' ? 'Power on' : 'Power off' }}</button>
      <button type="button" class="fg-button" data-testid="machine-reset" title="Turn the TRS-80 off and on again: a cold start from its ROM" @click="turnOn('reset')">Reset</button>
      <button type="button" class="fg-button" data-testid="run-pause" :disabled="!canPause" :title="pauseTitle" @click="pauseOrContinue">{{ machinePaused ? 'Continue' : 'Pause' }}</button>
      <button type="button" class="fg-button" data-testid="screen-fullscreen" :aria-pressed="screenFull" :disabled="!(screen?.canFullscreen ?? false)" title="Show the TRS-80's screen on the whole display (Esc leaves it)" @click="screen?.toggleFullscreen()">{{ screenFull ? 'Leave full screen' : 'Full screen' }}</button>
    </div>
    <ProgramsToTry @run="tryProgram" />
    <details class="fg-run-debugger" data-testid="debugger" ref="debuggerBox">
      <summary data-testid="debugger-summary">Debugger</summary>
      <div class="fg-run-debug" role="group" aria-label="Debugger controls">
        <button type="button" class="fg-button" data-testid="run-step" :disabled="!underWay" title="Step: run one instruction (F11 or F7)" @click="debug.step()">Step</button>
        <button type="button" class="fg-button" data-testid="run-step-over" :disabled="!underWay" title="Step Over: run one instruction, or a whole CALL, RST or block instruction (F10)" @click="debug.stepOver()">Step Over</button>
        <button type="button" class="fg-button" data-testid="run-to-here" :disabled="!underWay" :title="`Run to Here: run to the line under the cursor in Source ✎ (${hereKey})`" @click="runToHere">Run to Here</button>
        <label class="fg-run-follow" title="Keep the running line in view while the program runs">
          <input type="checkbox" data-testid="run-follow" :checked="debug.follow.value" @change="debug.follow.value = ($event.target as HTMLInputElement).checked" />
          Follow
        </label>
      </div>
      <RegistersPanel :debug="debug" />
      <BreakpointList class="fg-run-bps" :run="run" :sources="sources" />
      <ScreenText ref="screenText" :machine="machine" />
    </details>
    <div class="fg-run-rom" data-testid="run-rom">
      <h2 class="fg-strong">{{ MODEL_NAMES[model] }} ROM</h2>
      <p v-if="rom !== null" data-testid="run-rom-have">
        <span class="fg-mono">{{ rom.name }}</span>, {{ rom.recognized === null ? 'which Fugløy does not recognise' : 'recognised' }}, kept in this browser.
        <button type="button" class="fg-button" data-testid="run-rom-remove" @click="removeRom">Remove</button>
      </p>
      <p v-else class="fg-muted" data-testid="run-rom-none">
        None yet. Programs that do not call the ROM run on Fugløy's own stub ROM. To run one that does, add your {{ MODEL_NAMES[model] }} ROM image: choose it, or drop it on this tab.
      </p>
      <p>
        <button type="button" class="fg-button" data-testid="run-rom-add" @click="picker?.click()">{{ rom === null ? 'Add a ROM…' : 'Replace the ROM…' }}</button>
        <input ref="picker" type="file" class="sr-only" tabindex="-1" aria-hidden="true" data-testid="run-rom-input" @change="onPick" />
      </p>
      <p class="fg-muted fg-run-note">A ROM stays in this browser: it is never uploaded and never goes in a backup.</p>
      <p class="fg-muted fg-run-note" data-testid="run-keeps-running">A program keeps running while you look at another tab of the workbench; it pauses while this browser tab is hidden, and Stop or leaving the workbench ends it.</p>
      <!-- Both regions stay in the page, so a screen reader announces what fills them: news politely, a refusal at once. -->
      <p role="status" data-testid="run-rom-status">{{ romProblem ? '' : romMessage }}</p>
      <p class="fg-run-problem" role="alert" data-testid="run-rom-alert">{{ romProblem ? romMessage : '' }}</p>
      <p v-if="roms.unavailable.value !== null" class="fg-run-problem" role="alert">{{ roms.unavailable.value }}</p>
    </div>
  </section>
</template>

<style scoped>
.fg-run { display: flex; flex: 1; min-height: 0; flex-direction: column; gap: 10px; overflow: auto; padding: 0 0 12px; font-size: 13px; }
.fg-run-over { outline: 2px dashed var(--fg-accent); outline-offset: -4px; }
.fg-run-bar { display: flex; flex: none; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px 12px; border-bottom: 1px solid var(--fg-border); font-size: 12px; }
.fg-run-message { margin: 0 12px; min-height: 1.5em; }
.fg-run-problem { color: var(--fg-error); }
.fg-run-debug { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 6px 0; }
.fg-run-follow { display: inline-flex; align-items: center; gap: 4px; margin-left: 6px; }
.fg-run-screen { flex: none; min-width: 0; padding: 0 12px; }
.fg-run-machine-row { display: flex; flex: none; flex-wrap: wrap; align-items: center; gap: 6px; padding: 0 12px; }
.fg-run-debugger { margin: 0 12px; }
.fg-run-debugger > summary { cursor: pointer; width: fit-content; font-weight: 700; }
.fg-run-debugger > summary:focus-visible { outline: 2px solid var(--fg-accent); outline-offset: 2px; }
.fg-run-bps { margin: 6px 0 0; }
.fg-run-rom { margin: 0 12px; display: flex; flex-direction: column; gap: 4px; }
.fg-run-rom h2 { margin: 6px 0 0; font-size: 13px; font-weight: 700; }
.fg-run-rom p { margin: 0; }
.fg-run-note { font-size: 12px; }
</style>
