import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return;
          }

          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("scheduler")
          ) {
            return "react-vendor";
          }

          if (id.includes("@fullcalendar")) {
            return "calendar-vendor";
          }

          if (id.includes("@tauri-apps")) {
            return "tauri-vendor";
          }

          if (id.includes("date-fns") || id.includes("date-fns-tz")) {
            return "date-vendor";
          }

          if (id.includes("@tanstack")) {
            return "query-vendor";
          }

          return "vendor";
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 1420,
    strictPort: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    strictPort: true,
  },
});
