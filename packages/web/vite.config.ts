import react from "@vitejs/plugin-react";
import { defineConfig, searchForWorkspaceRoot } from "vite";

const webPort = Number(process.env.WEB_PORT ?? 18081);
const apiPort = Number(process.env.API_PORT ?? 3000);

export default defineConfig({
  plugins: [react()],
  server: {
    port: webPort,
    strictPort: true,
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd())]
    },
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`,
      "/healthz": `http://127.0.0.1:${apiPort}`
    }
  }
});
