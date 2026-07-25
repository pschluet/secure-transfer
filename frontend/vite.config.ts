import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());
  return {
    plugins: [react()],
    server: {
      proxy: {
        // Local dev convenience: run against a deployed HttpApi by setting
        // VITE_DEV_API_PROXY_TARGET (env var or frontend/.env), so relative
        // /api calls work without CORS.
        "/api": {
          target: env.VITE_DEV_API_PROXY_TARGET ?? "http://localhost:3000",
          changeOrigin: true,
        },
      },
    },
  };
});
