import { createRouter, createWebHistory } from "vue-router";

export const router = createRouter({
  history: createWebHistory("/"),
  routes: [
    { path: "/", redirect: "/calendar" },
    { path: "/library", name: "library", component: () => import("./views/LibraryView.vue") },
    { path: "/calendar", name: "calendar", component: () => import("./views/CalendarView.vue") },
    { path: "/:pathMatch(.*)*", redirect: "/library" },
  ],
});
