import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Local dev convenience: run against a deployed HttpApi by setting
      // VITE_DEV_API_PROXY_TARGET, so relative /api calls work without CORS.
      "/api": {
        target: process.env.VITE_DEV_API_PROXY_TARGET ?? "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
