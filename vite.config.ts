import vinext from "vinext";
import { defineConfig } from "vite";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

export default defineConfig({
  server: {
    host: process.env.DEV_HOST || "127.0.0.1",
    fs: {
      strict: true,
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem,key}",
        ".local-state/**",
        "data/**",
        "app/data/trip.json",
        "app/data/packing.json",
        "package-lock.json",
        "server.mjs",
        ".npmrc",
      ],
    },
    ...(isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : {}),
  },
  plugins: [vinext()],
});
