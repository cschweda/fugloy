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
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import TrsScreen from './TrsScreen.vue';
import RegistersPanel from './RegistersPanel.vue';
import BreakpointList from './BreakpointList.vue';
import type { DebugKeyOptions } from '~/utils/running/debug-keys';
import { useRoms } from '~/composables/useRoms';
import type { Run } from '~/composables/useRun';
import type { Sources } from '~/composables/useSources';
import { MODEL_NAMES } from '~/utils/emulator/rom-ids';
import type { ModelId } from '~/utils/store';

// The page hands over its Run and sources, so this lazy chunk imports none of the first screen's modules.
const props = defineProps<{ run: Run; sources: Sources }>();
const run = props.run;
const sources = props.sources;
const debug = run.debug;
const roms = useRoms();
const screen = ref<InstanceType<typeof TrsScreen> | null>(null);
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
const runKey = computed(() => (isMac.value ? '⌘+Enter' : 'Ctrl+Enter'));
/** Stepping needs a program running or paused. */
const underWay = computed(() => debug.mode.value === 'running' || debug.mode.value === 'paused');
const paused = computed(() => debug.mode.value === 'paused');
const hereKey = computed(() => (isMac.value ? '⌘+F10' : 'Ctrl+F10'));
/** The run message says what the announcer already says: not a second live region for it. */
const quiet = computed(() => run.message.value !== null && debug.announcement.value?.text === run.message.value);

/** In utils/lazy's loadFailed words, with reloading as the next step (lazy code does not import utils/lazy). */
const KEYS_FAILED = 'The debugger could not be loaded: the connection may have dropped, or the site was updated since this page opened. Reload the page.';
/** A sentence from a debug control that cannot act. */
function sayProblem(text: string): void {
  run.message.value = text;
  run.problem.value = true;
}
function pauseOrContinue(): void {
  if (paused.value) debug.continue();
  else debug.pause();
}

function setModel(e: Event): void {
  const src = sources.current.value;
  if (src === null) return;
  sources.update(src.id, { model: Number((e.target as HTMLSelectElement).value) as ModelId });
}

async function addRom(file: File): Promise<void> {
  romMessage.value = null;
  const r = await roms.add(file, undefined, model.value);
  romProblem.value = !r.ok;
  romMessage.value = r.ok ? `${file.name} is kept in this browser as the ${MODEL_NAMES[r.model]} ROM. Press Run to use it.` : r.reason;
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
let uninstallKeys: (() => void) | null = null;
let gone = false;
const keyOptions: DebugKeyOptions = { runNow: () => void run.run(), stop: () => run.stop(), focusTarget: () => null, say: sayProblem };
function runToHere(): void {
  if (keys === null) return sayProblem(KEYS_FAILED);
  keys.runToHere(debug, keyOptions);
}
onMounted(() => {
  isMac.value = /Mac|iPhone|iPad/.test(navigator.platform);
  void roms.start();
  void sources.start();
  unsubscribe = run.onFrame(() => screen.value?.draw());
  import('~/utils/running/debug-keys').then(
    (m) => {
      if (gone) return;
      keys = m;
      uninstallKeys = m.installDebugKeys(debug, keyOptions);
    },
    () => sayProblem(KEYS_FAILED),
  );
});
onBeforeUnmount(() => {
  gone = true;
  unsubscribe?.();
  uninstallKeys?.();
});

defineExpose({
  focusScreen(): void {
    screen.value?.focus();
  },
});
</script>

<template>
  <section class="fg-run" :class="{ 'fg-run-over': over }" aria-label="Run" data-testid="run-tab" @dragover="onDragOver" @dragleave="over = false" @drop="onDrop">
    <div class="fg-run-bar" role="group" aria-label="Run controls">
      <label for="run-model" class="fg-muted">Model</label>
      <select id="run-model" class="fg-input" data-testid="run-model" :value="model" :disabled="sources.current.value === null" @change="setModel">
        <option v-for="m in MODELS" :key="m" :value="m">{{ MODEL_NAMES[m] }}</option>
      </select>
      <button type="button" class="fg-button fg-button-primary" data-testid="run-run" :aria-busy="run.busy.value" :title="`Assemble and run (${runKey})`" @click="run.run()">Run ▶</button>
      <button type="button" class="fg-button" data-testid="run-stop" :disabled="!running && !run.busy.value" @click="run.stop()">Stop</button>
      <button type="button" class="fg-button" data-testid="run-show-listing" :disabled="!run.listable.value" @click="run.showInListing()">Show in Listing</button>
      <span class="fg-run-debug" role="group" aria-label="Debugger controls">
        <button type="button" class="fg-button" data-testid="run-pause" :disabled="!underWay" :title="paused ? 'Continue running (F5)' : 'Pause the program (F6)'" @click="pauseOrContinue">{{ paused ? 'Continue' : 'Pause' }}</button>
        <button type="button" class="fg-button" data-testid="run-step" :disabled="!underWay" title="Step: run one instruction (F11 or F7)" @click="debug.step()">Step</button>
        <button type="button" class="fg-button" data-testid="run-step-over" :disabled="!underWay" title="Step Over: run one instruction, or a whole CALL, RST or block instruction (F10)" @click="debug.stepOver()">Step Over</button>
        <button type="button" class="fg-button" data-testid="run-to-here" :disabled="!underWay" :title="`Run to Here: run to the line under the cursor in Source ✎ (${hereKey})`" @click="runToHere">Run to Here</button>
        <label class="fg-run-follow" title="Keep the running line in view while the program runs">
          <input type="checkbox" data-testid="run-follow" :checked="debug.follow.value" @change="debug.follow.value = ($event.target as HTMLInputElement).checked" />
          Follow
        </label>
      </span>
    </div>
    <p class="fg-run-message" :class="{ 'fg-run-problem': run.problem.value }" role="status" :aria-live="quiet ? 'off' : 'polite'" data-testid="run-message">
      {{ run.message.value ?? `Press Run ▶ or ${runKey} to assemble the source and run it on a fresh ${MODEL_NAMES[model]}.` }}
    </p>
    <div class="fg-run-machine">
      <div class="fg-run-screen"><TrsScreen ref="screen" :machine="machine" :running="running" /></div>
      <RegistersPanel :debug="debug" />
    </div>
    <BreakpointList class="fg-run-bps" :run="run" :sources="sources" />
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
.fg-run-debug { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.fg-run-follow { display: inline-flex; align-items: center; gap: 4px; margin-left: 6px; }
.fg-run-machine { display: flex; flex: none; flex-wrap: wrap; align-items: flex-start; gap: 12px; padding: 0 12px; }
.fg-run-screen { flex: 1 1 24rem; min-width: 0; max-width: 768px; }
.fg-run-bps { margin: 0 12px; }
.fg-run-rom { margin: 0 12px; display: flex; flex-direction: column; gap: 4px; }
.fg-run-rom h2 { margin: 6px 0 0; font-size: 13px; font-weight: 700; }
.fg-run-rom p { margin: 0; }
.fg-run-note { font-size: 12px; }
</style>
