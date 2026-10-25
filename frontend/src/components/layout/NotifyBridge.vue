<script setup lang="ts">
import { useDialog, useMessage } from "naive-ui";
import { bindNotify } from "@/composables/notify";

bindNotify(useMessage(), useDialog());
</script>

<template>
  <span hidden />
</template>
