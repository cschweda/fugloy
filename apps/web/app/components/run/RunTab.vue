<script setup lang="ts">
// Run ▶ (plan 5B, Task 4): the model the source is written for, Run (Ctrl/⌘+Enter anywhere in
// the workbench), Stop, Show in Listing, what the run says, the TRS-80's screen, and the ROM for
// the model, added from a file or dropped on the tab and kept in this browser only. The page
// loads this component lazily, with emu.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import TrsScreen from './TrsScreen.vue';
import { useRoms } from '~/composables/useRoms';
import type { Run } from '~/composables/useRun';
import type { Sources } from '~/composables/useSources';
import { MODEL_NAMES } from '~/utils/emulator/rom-ids';
import type { ModelId } from '~/utils/store';

// The page hands over its Run and sources, so this lazy chunk imports none of the first screen's modules.
const props = defineProps<{ run: Run; sources: Sources }>();
const run = props.run;
const sources = props.sources;
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
const running = computed(() => run.state.value === 'running');
const rom = computed(() => roms.info(model.value));
const runKey = computed(() => (isMac.value ? '⌘+Enter' : 'Ctrl+Enter'));

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
onMounted(() => {
  isMac.value = /Mac|iPhone|iPad/.test(navigator.platform);
  void roms.start();
  void sources.start();
  unsubscribe = run.onFrame(() => screen.value?.draw());
});
onBeforeUnmount(() => unsubscribe?.());

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
      <button type="button" class="fg-button" data-testid="run-stop" :disabled="!running" @click="run.stop()">Stop</button>
      <button type="button" class="fg-button" data-testid="run-show-listing" :disabled="!run.listable.value" @click="run.showInListing()">Show in Listing</button>
    </div>
    <p class="fg-run-message" :class="{ 'fg-run-problem': run.problem.value }" role="status" aria-live="polite" data-testid="run-message">
      {{ run.message.value ?? `Press Run ▶ or ${runKey} to assemble the source and run it on a fresh ${MODEL_NAMES[model]}.` }}
    </p>
    <div class="fg-run-screen"><TrsScreen ref="screen" :machine="machine" :running="running" /></div>
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
.fg-run-screen { flex: none; padding: 0 12px; }
.fg-run-rom { margin: 0 12px; display: flex; flex-direction: column; gap: 4px; }
.fg-run-rom h2 { margin: 6px 0 0; font-size: 13px; font-weight: 700; }
.fg-run-rom p { margin: 0; }
.fg-run-note { font-size: 12px; }
</style>
