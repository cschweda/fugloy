<script setup lang="ts">
// One listing row, laid out on the grid ListingView sets: address, bytes, text,
// comment. Presentational only: ListingView handles clicks, follows, and context
// menus for every row at once through the data-addr and data-target attributes.
import type { Row } from '@fugloy/disasm';
import { hexWord } from '@fugloy/z80';
import { hexAddr, hexBytes, isFollowable, spanClass } from '../../utils/row-classes';
import { spanUseKind } from '../../utils/xrefs';

defineProps<{ row: Row; cursor: boolean; selected: boolean; /** The row is the header's show/hide toggle (a note row; ListingView handles the click). */ toggle?: boolean }>();
</script>

<template>
  <div
    class="fg-row"
    :class="{ 'fg-row-cursor': cursor, 'fg-row-selected': selected, [`fg-row-${row.kind}`]: true }"
    :data-addr="'addr' in row ? row.addr : undefined"
  >
    <template v-if="row.kind === 'code' || row.kind === 'data'">
      <span class="fg-col-addr">{{ hexAddr(row.addr) }}</span>
      <span class="fg-col-bytes">{{ hexBytes(row.bytes) }}</span>
      <span class="fg-col-text"><template v-for="(span, i) in row.spans" :key="i"><a
        v-if="isFollowable(span)"
        :href="`#$${hexAddr(span.target)}`"
        tabindex="-1"
        :data-target="span.target"
        :data-span="span.kind"
        :data-use="spanUseKind(span)"
        :data-table="span.entry?.table"
        :data-key="span.entry?.key"
        :class="`${spanClass(span.kind)} fg-follow`"
      >{{ span.text }}</a><span v-else :class="spanClass(span.kind)">{{ span.text }}</span></template></span>
      <span v-if="row.comment !== undefined" class="fg-col-comment fg-tok-comment">; {{ row.comment }}</span>
    </template>
    <span v-else-if="row.kind === 'label'" class="fg-col-full fg-tok-label" :class="{ 'fg-label-user': row.user }">{{ row.name }}:</span>
    <template v-else-if="row.kind === 'org'">
      <span class="fg-col-addr" />
      <span class="fg-col-bytes" />
      <span class="fg-col-text"><span class="fg-tok-directive">ORG</span> <span class="fg-tok-number">{{ hexWord(row.addr) }}</span></span>
    </template>
    <span v-else-if="row.kind === 'basic'" class="fg-col-full"><span class="fg-tok-number">{{ row.line }}</span><template v-if="row.text !== ''"> {{ row.text }}</template></span>
    <button v-else-if="toggle && row.kind === 'note'" type="button" class="fg-col-full fg-header-toggle fg-tok-comment" data-testid="header-toggle">{{ row.text }}</button>
    <span v-else-if="row.kind === 'header' || row.kind === 'note'" class="fg-col-full fg-tok-comment">{{ row.text }}</span>
  </div>
</template>
