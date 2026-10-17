<script setup lang="ts" generic="T extends string">
// A page's tab strip. Tabs marked `later` are shown dimmed with a "coming later"
// tooltip, so the site shows where it is going; they cannot be selected.
export interface PageTab<Id extends string> {
  id: Id;
  label: string;
  later?: boolean;
}

const props = defineProps<{ tabs: readonly PageTab<T>[]; label: string; idPrefix: string }>();
const active = defineModel<T>({ required: true });

function onKey(e: KeyboardEvent, tabs: readonly PageTab<T>[]): void {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const live = tabs.filter((t) => t.later !== true);
  const i = live.findIndex((t) => t.id === active.value);
  const next = live[(i + (e.key === 'ArrowRight' ? 1 : live.length - 1)) % live.length];
  if (next === undefined) return;
  active.value = next.id;
  e.preventDefault();
  (e.currentTarget as HTMLElement).querySelector<HTMLElement>(`#${props.idPrefix}-tab-${next.id}`)?.focus();
}
</script>

<template>
  <div class="fg-tabs" role="tablist" :aria-label="label" @keydown="onKey($event, tabs)">
    <template v-for="tab in tabs" :key="tab.id">
      <span
        v-if="tab.later"
        role="tab"
        class="fg-tab fg-tab-later"
        aria-disabled="true"
        aria-selected="false"
        tabindex="-1"
        :aria-describedby="`${idPrefix}-tip-${tab.id}`"
      >
        {{ tab.label }}
        <span :id="`${idPrefix}-tip-${tab.id}`" class="fg-tip" role="tooltip">Coming later</span>
      </span>
      <button
        v-else
        :id="`${idPrefix}-tab-${tab.id}`"
        type="button"
        role="tab"
        class="fg-tab"
        :class="{ 'fg-tab-on': active === tab.id }"
        :aria-selected="active === tab.id"
        :aria-controls="`${idPrefix}-panel-${tab.id}`"
        :tabindex="active === tab.id ? 0 : -1"
        @click="active = tab.id"
      >
        {{ tab.label }}
      </button>
    </template>
  </div>
</template>
