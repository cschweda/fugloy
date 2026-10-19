<script setup lang="ts">
// The registers and flags (phase 5C Ruling 11), in Run ▶ beside the screen: AF, BC, DE, HL, IX,
// IY, SP, PC, the alternates, I, R, IM, and IFF1/IFF2; the flags in F spelled out, each 0 or 1.
// After each pause or step, what changed since the previous pause is marked by colour and by the
// word "changed" for screen readers (PC and R move always and are never marked). While running,
// they update 4 times a second (useDebug). No live region: the announcer says what a step changed.
import type { Debug } from '~/composables/useDebug';

defineProps<{ debug: Debug }>();
</script>

<template>
  <section class="fg-regs" aria-labelledby="run-regs-title" data-testid="registers">
    <h2 id="run-regs-title" class="fg-strong">Registers</h2>
    <p v-if="debug.registers.value === null" class="fg-muted">The registers show here while a program runs.</p>
    <template v-else>
      <table class="fg-regs-table fg-mono">
        <caption class="sr-only">The Z80's registers{{ debug.mode.value === 'paused' ? ', marked where they changed since the last pause' : '' }}</caption>
        <tbody>
          <tr v-for="r in debug.registers.value.rows" :key="r.name" :class="{ 'fg-reg-changed': r.changed }" data-testid="reg-row">
            <th scope="row" data-testid="reg-name">{{ r.name }}</th>
            <td data-testid="reg-value">{{ r.value }}<span v-if="r.changed" class="sr-only"> changed</span></td>
          </tr>
        </tbody>
      </table>
      <table class="fg-regs-table fg-regs-flags">
        <caption class="fg-muted">Flags (F)</caption>
        <tbody>
          <tr v-for="f in debug.registers.value.flags" :key="f.name" :class="{ 'fg-reg-changed': f.changed }" data-testid="flag-row">
            <th scope="row">{{ f.name }}</th>
            <td class="fg-mono">{{ f.value }}<span v-if="f.changed" class="sr-only"> changed</span></td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style scoped>
.fg-regs { display: flex; flex-direction: column; gap: 4px; min-width: 11rem; font-size: 12px; }
.fg-regs h2 { margin: 0; font-size: 13px; font-weight: 700; }
.fg-regs p { margin: 0; }
.fg-regs-table { border-collapse: collapse; }
.fg-regs-table caption { text-align: left; padding-top: 4px; }
.fg-regs-table th { padding: 0 10px 0 0; text-align: left; font-weight: 400; color: var(--fg-muted); white-space: nowrap; }
.fg-regs-table td { padding: 0; color: var(--fg-text); white-space: nowrap; }
.fg-regs-table tr.fg-reg-changed th,
.fg-regs-table tr.fg-reg-changed td { color: var(--fg-string); font-weight: 700; }
</style>
