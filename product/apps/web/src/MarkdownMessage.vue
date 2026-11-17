<script setup lang="ts">
import { computed } from "vue";
import { marked } from "marked";
import DOMPurify from "dompurify";

const props = defineProps<{ content: string }>();
const html = computed(() => DOMPurify.sanitize(marked.parse(props.content, {
  async: false, gfm: true, breaks: true
}), {
  ALLOWED_TAGS: ["p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "em",
    "del", "s", "blockquote", "ul", "ol", "li", "pre", "code", "a", "table", "thead", "tbody", "tr", "th", "td"],
  ALLOWED_ATTR: ["href", "title", "class", "start", "align"],
  ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false
}));
</script>

<template>
  <div class="chat-markdown" v-html="html" />
</template>
