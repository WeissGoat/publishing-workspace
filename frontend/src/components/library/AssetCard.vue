<script setup lang="ts">
import { Check, Star } from "@lucide/vue";
import { computed } from "vue";
import { thumbUrl, type AssetItem } from "@/api";

const props = defineProps<{
  item: AssetItem;
  width: number;
  order: number;
  focused: boolean;
  favorite: boolean;
  posted: boolean;
  spotlight: boolean;
}>();

const emit = defineEmits<{
  open: [];
  select: [event: MouseEvent];
  activate: [event: MouseEvent];
  favorite: [];
}>();

const ratio = computed(() =>
  props.item.width && props.item.height ? `${props.item.width} / ${props.item.height}` : "1 / 1",
);
const src = computed(() => thumbUrl(props.item.asset_id, props.width));
</script>

<template>
  <div
    class="card"
    :class="{ selected: order > 0, focused, spotlight }"
    :data-asset-id="item.asset_id"
    @click="emit('activate', $event)"
    @dblclick.stop="emit('open')"
  >
    <div class="thumb" :style="{ aspectRatio: ratio }">
      <img :src="src" :alt="item.display_name" loading="lazy" decoding="async" draggable="false" />
      <button
        type="button"
        class="check"
        :class="{ on: order > 0 }"
        :aria-label="order > 0 ? '取消选择' : '选择'"
        @click.stop="emit('select', $event)"
      >
        <span v-if="order > 0" class="order">{{ order }}</span>
        <Check v-else :size="13" :stroke-width="3" />
      </button>
      <span v-if="posted" class="posted">已投稿</span>
      <button
        type="button"
        class="star"
        :class="{ on: favorite }"
        :aria-label="favorite ? '取消收藏' : '收藏'"
        @click.stop="emit('favorite')"
      >
        <Star :size="15" :fill="favorite ? 'currentColor' : 'none'" />
      </button>
    </div>
    <div class="info">
      <div class="name truncate" :title="item.display_name">{{ item.display_name }}</div>
      <div v-if="item.tags.length" class="tags">
        <span v-for="t in item.tags" :key="t" class="tag">{{ t }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.card {
  position: relative;
  border-radius: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.12s, box-shadow 0.12s, transform 0.12s;
}

.card:hover {
  border-color: var(--border-strong);
}

.card.focused {
  border-color: var(--primary);
  box-shadow: 0 0 0 1px var(--primary);
}

.card.selected {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px var(--primary);
}

.card.spotlight {
  animation: spotlight 1.4s ease-out;
}

@keyframes spotlight {
  0%,
  40% {
    box-shadow: 0 0 0 4px var(--warning), 0 0 24px var(--warning);
  }
  100% {
    box-shadow: 0 0 0 1px var(--primary);
  }
}

.thumb {
  position: relative;
  width: 100%;
  background: var(--image-bg);
  overflow: hidden;
}

.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.check {
  position: absolute;
  top: 6px;
  left: 6px;
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, 0.85);
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s, background 0.12s;
}

.card:hover .check,
.check.on,
:global(.batch-mode) .check {
  opacity: 1;
}

.check:hover {
  background: rgba(0, 0, 0, 0.55);
}

.check.on {
  border-color: var(--primary);
  background: var(--primary);
}

.order {
  font-size: 11px;
  font-weight: 700;
}

.posted {
  position: absolute;
  left: 6px;
  bottom: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--success);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
}

.star {
  position: absolute;
  top: 5px;
  right: 5px;
  display: inline-grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s, transform 0.12s;
}

.card:hover .star,
.star.on {
  opacity: 1;
}

.star.on {
  color: var(--favorite);
  background: rgba(0, 0, 0, 0.45);
}

.star:active {
  transform: scale(0.88);
}

.info {
  padding: 6px 8px 7px;
}

.name {
  font-size: 12px;
  color: var(--text-muted);
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin-top: 4px;
}

.tag {
  padding: 0 5px;
  border-radius: 3px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 11px;
  line-height: 18px;
}
</style>
