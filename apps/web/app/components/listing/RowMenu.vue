<script setup lang="ts">
// The listing's right-click menu: the editing keys' actions, each with its key
// shown. Opened by a right-click on a row, the ContextMenu key, or Shift+F10.
// It keeps its own keys while open (arrows, Enter, Esc, and each item's key),
// so the workbench's do not also fire.
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

export interface MenuItem {
  id: string;
  label: string;
  /** The key shown beside the label, as the user presses it. */
  keys?: string;
  /** The `KeyboardEvent.key` (lowercase) that picks the item while the menu is open. */
  accel?: string;
  disabled?: boolean;
  /** A rule above this item. */
  rule?: boolean;
}

const props = defineProps<{ items: readonly MenuItem[]; x: number; y: number }>();
const emit = defineEmits<{ pick: [id: string]; close: [] }>();

const menu = ref<HTMLElement | null>(null);
const left = ref(props.x);
const top = ref(props.y);

const buttons = (): HTMLButtonElement[] => Array.from(menu.value?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []);

function move(by: number): void {
  const list = buttons();
  if (list.length === 0) return;
  const i = list.indexOf(document.activeElement as HTMLButtonElement);
  list[(i + by + list.length) % list.length]!.focus();
}

function pick(item: MenuItem): void {
  if (item.disabled !== true) emit('pick', item.id);
}

function onKeydown(e: KeyboardEvent): void {
  e.stopPropagation();
  if (e.key === 'ArrowDown') move(1);
  else if (e.key === 'ArrowUp') move(-1);
  else if (e.key === 'Home') buttons()[0]?.focus();
  else if (e.key === 'End') buttons().at(-1)?.focus();
  else if (e.key === 'Escape' || e.key === 'Tab') emit('close');
  else if (e.key === 'Enter' || e.key === ' ') return; // the focused button's own click
  else {
    const item = props.items.find((i) => i.accel !== undefined && i.accel === e.key.toLowerCase() && !e.ctrlKey && !e.metaKey && !e.altKey);
    if (item === undefined) return;
    pick(item);
  }
  e.preventDefault();
}

/** A press outside the menu closes it. */
function onOutside(e: Event): void {
  if (e.target instanceof Node && menu.value?.contains(e.target) === true) return;
  emit('close');
}

onMounted(async () => {
  document.addEventListener('pointerdown', onOutside, true);
  window.addEventListener('resize', onOutside);
  await nextTick();
  // Keep the whole menu on screen.
  const el = menu.value;
  if (el !== null) {
    const r = el.getBoundingClientRect();
    left.value = Math.max(4, Math.min(props.x, window.innerWidth - r.width - 4));
    top.value = Math.max(4, Math.min(props.y, window.innerHeight - r.height - 4));
  }
  buttons()[0]?.focus();
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onOutside, true);
  window.removeEventListener('resize', onOutside);
});
</script>

<template>
  <div
    ref="menu"
    class="fg-menu"
    role="menu"
    aria-label="Row actions"
    data-testid="row-menu"
    :style="{ left: `${left}px`, top: `${top}px` }"
    @keydown="onKeydown"
    @contextmenu.prevent
  >
    <template v-for="item in items" :key="item.id">
      <div v-if="item.rule" class="fg-menu-rule" role="separator" />
      <button type="button" role="menuitem" class="fg-menu-item" tabindex="-1" :disabled="item.disabled" :data-id="item.id" @click="pick(item)">
        <span>{{ item.label }}</span>
        <kbd v-if="item.keys" class="fg-menu-key">{{ item.keys }}</kbd>
      </button>
    </template>
  </div>
</template>
