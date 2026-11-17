<script setup lang="ts">
import { computed } from "vue";
interface Schema { type?: string; title?: string; description?: string; enum?: unknown[];
  properties?: Record<string, Schema>; required?: string[]; minimum?: number; maximum?: number; minLength?: number }
const props = defineProps<{ schema: Schema; modelValue: unknown; name: string; required?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: unknown] }>();
const objectValue = computed(() => (props.modelValue ?? {}) as Record<string, unknown>);
function field(key: string, value: unknown) { emit("update:modelValue", { ...objectValue.value, [key]: value }); }
function input(event: Event) {
  const target = event.target as HTMLInputElement;
  emit("update:modelValue", props.schema.type === "number" || props.schema.type === "integer" ? Number(target.value) : target.value);
}
function complex(event: Event) {
  const target = event.target as HTMLTextAreaElement;
  try { const value: unknown = JSON.parse(target.value); if (!Array.isArray(value)) throw new Error("array required"); target.setCustomValidity(""); emit("update:modelValue", value); }
  catch { target.setCustomValidity("JSON 格式无效"); }
}
</script>
<template>
  <fieldset v-if="schema.type === 'object'" class="schema-object">
    <legend v-if="name">{{ schema.title || name }}</legend>
    <SchemaField v-for="(child, key) in schema.properties" :key="key" :name="key" :schema="child"
      :model-value="objectValue[key]" :required="schema.required?.includes(key) ?? false" @update:model-value="field(key, $event)" />
  </fieldset>
  <label v-else class="schema-field" :title="schema.description">
    <span>{{ schema.title || name }}<span v-if="required"> *</span></span>
    <select v-if="schema.enum" :value="modelValue" :required="required" @change="input">
      <option value="">选择</option><option v-for="value in schema.enum" :key="String(value)" :value="String(value)">{{ value }}</option>
    </select>
    <input v-else-if="schema.type === 'boolean'" type="checkbox" :checked="Boolean(modelValue)" @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)" />
    <textarea v-else-if="schema.type === 'array'" :value="JSON.stringify(modelValue ?? [])" :required="required" rows="3" @input="complex" />
    <input v-else :type="['integer', 'number'].includes(schema.type ?? '') ? 'number' : 'text'" :step="schema.type === 'integer' ? 1 : 'any'"
      :min="schema.minimum" :max="schema.maximum" :minlength="schema.minLength" :required="required" :value="modelValue ?? ''" @input="input" />
  </label>
</template>
