<script setup lang="ts">
// The Learn page's TRS-80 column (phase 6B Task 4), a lazy root: the run message, the screen (6A's
// shape for the model, and Full screen), Pause/Continue, Step and Step Over, the registers and flags
// (5C's panel) and the screen as text, and the Model switch when the lesson runs on two models. It
// always runs on Fugløy's stub ROM (the page's Run is stub-only), so there is no Power, Reset, ROM or
// Program to try. The run message says Run ▶'s sentences the lesson's way (utils/learn/page's
// lessonMessage: this page has no Source ✎ tab and no ROM). The keys reach the TRS-80 only while the
// screen has focus (TrsScreen), never from the editor. Changing the model stops the run (useRun
// says why), and the next Run assembles for that model.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import TrsScreen from './TrsScreen.vue';
import ScreenText from './ScreenText.vue';
import RegistersPanel from './RegistersPanel.vue';
import type { Run } from '~/composables/useRun';
import type { Sources } from '~/composables/useSources';
import { announcing, speakAnnouncements } from '~/utils/running/announce';
import { lessonMessage, modelOptions } from '~/utils/learn/page';

const props = defineProps<{ run: Run; sources: Sources; models: readonly (1 | 3)[] }>();
const run = props.run;
const debug = run.debug;
const sources = props.sources;
const screen = ref<InstanceType<typeof TrsScreen> | null>(null);
const screenText = ref<InstanceType<typeof ScreenText> | null>(null);
const isMac = ref(false);

const options = computed(() => modelOptions(props.models));
const model = computed<1 | 3>(() => (sources.current.value?.model === 1 ? 1 : 3));
const machine = computed(() => run.runner.value?.machine ?? null);
const running = computed(() => run.state.value === 'running' || run.state.value === 'paused');
const underWay = computed(() => debug.mode.value === 'running' || debug.mode.value === 'paused');
const paused = computed(() => debug.mode.value === 'paused');
const screenFull = computed(() => screen.value?.fullscreen ?? false);
const runKey = computed(() => (isMac.value ? '⌘+Enter' : 'Ctrl+Enter'));
const modelName = computed(() => options.value.find((o) => o.value === model.value)?.label ?? 'Model III');
const message = computed(() => (run.message.value === null ? `Press Run ▶ or ${runKey.value} to assemble the program and run it on a fresh ${modelName.value}.` : lessonMessage(run.message.value)));
/** The run message stays quiet for a sentence the announcer already says. */
const quiet = computed(() => announcing.value && run.message.value !== null && debug.announcement.value?.text === run.message.value);

function setModel(e: Event): void {
  const src = sources.current.value;
  if (src === null) return;
  sources.update(src.id, { model: Number((e.target as HTMLSelectElement).value) as 1 | 3 });
}

function pauseOrContinue(): void {
  if (paused.value) debug.continue();
  else debug.pause();
}

let unsubscribe: (() => void) | null = null;
let unspeak: (() => void) | null = null;
onMounted(() => {
  isMac.value = /Mac|iPhone|iPad/.test(navigator.platform);
  unsubscribe = run.onFrame(() => {
    screen.value?.draw();
    screenText.value?.refresh();
  });
  unspeak = speakAnnouncements(debug);
});
onBeforeUnmount(() => {
  unsubscribe?.();
  unspeak?.();
});
</script>

<template>
  <div class="fg-lesson-machine" data-testid="lesson-trs80">
    <div class="fg-lesson-machine-bar">
      <h2 class="fg-strong">TRS-80</h2>
      <template v-if="options.length > 1">
        <label for="lesson-model" class="fg-muted">Model</label>
        <select id="lesson-model" class="fg-input" data-testid="lesson-model" :value="model" @change="setModel">
          <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </template>
      <span v-else class="fg-muted">{{ modelName }}</span>
    </div>
    <p class="fg-lesson-message" :class="{ 'fg-lesson-problem': run.problem.value }" role="status" :aria-live="quiet ? 'off' : 'polite'" data-testid="lesson-message">{{ message }}</p>
    <TrsScreen ref="screen" :machine="machine" :running="running" :model="model" />
    <div class="fg-lesson-machine-row" role="group" aria-label="Debugger controls">
      <button type="button" class="fg-button" data-testid="lesson-pause" :disabled="!underWay" :title="paused ? 'Continue running (F5)' : 'Pause the program (F6)'" @click="pauseOrContinue">{{ paused ? 'Continue' : 'Pause' }}</button>
      <button type="button" class="fg-button" data-testid="lesson-step" :disabled="!underWay" title="Step: run one instruction (F11 or F7)" @click="debug.step()">Step</button>
      <button type="button" class="fg-button" data-testid="lesson-step-over" :disabled="!underWay" title="Step Over: run one instruction, or a whole CALL, RST or block instruction (F10)" @click="debug.stepOver()">Step Over</button>
      <button type="button" class="fg-button" data-testid="lesson-fullscreen" :aria-pressed="screenFull" :disabled="!(screen?.canFullscreen ?? false)" title="Show the TRS-80's screen on the whole display (Esc leaves it)" @click="screen?.toggleFullscreen()">Full screen</button>
    </div>
    <RegistersPanel :debug="debug" />
    <ScreenText ref="screenText" :machine="machine" />
  </div>
</template>

<style scoped>
.fg-lesson-machine { display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
.fg-lesson-machine-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.fg-lesson-machine-bar h2 { margin: 0 6px 0 0; font-size: 15px; font-weight: 700; }
.fg-lesson-message { margin: 0; min-height: 1.5em; }
.fg-lesson-problem { color: var(--fg-error); }
.fg-lesson-machine-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
</style>
