<script setup lang="ts">
import MachinePicker from '~/components/MachinePicker.vue';

const route = useRoute();
const wb = useWorkbench();
const onWorkbench = computed(() => route.path === '/' && wb.session.value !== null);
</script>

<template>
  <div class="fg-shell flex min-h-screen flex-col">
    <TopBar>
      <template #file>
        <template v-if="onWorkbench">
          <span class="fg-pill fg-mono" data-testid="file-name">{{ wb.session.value?.name }}</span>
          <button type="button" class="fg-link" data-testid="close-program" aria-label="Close the program and go back to the first screen" @click="wb.close()">Close</button>
        </template>
      </template>
      <template #pickers>
        <MachinePicker v-if="onWorkbench" />
      </template>
    </TopBar>
    <p class="fg-muted px-4 py-1 text-xs md:hidden">Fugløy is best on a desktop.</p>
    <main class="flex min-h-0 flex-1 flex-col overflow-x-hidden">
      <slot />
    </main>
  </div>
</template>
