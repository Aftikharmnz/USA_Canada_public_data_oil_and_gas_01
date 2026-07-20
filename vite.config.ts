import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Actions sets VITE_BASE_PATH to "/repository-name/" for a project
// site. Root-relative assets also keep copied /usa/, /products/, /canada/, and /reference/ entries valid.
const configuredBase = process.env.VITE_BASE_PATH?.trim();

export default defineConfig({
  base: configuredBase || "/",
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
