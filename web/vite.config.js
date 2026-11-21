import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Builds one self-contained index.html that server.py serves at "/".
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  server: { proxy: { "/api": "http://localhost:8000" } },
});
