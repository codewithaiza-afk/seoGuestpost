import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  nitro: { preset: process.env["VERCEL"] ? "vercel" : "node-server" },
  envDefine: false,
  tanstackStart: {
    server: { entry: "server" },
  },
});
