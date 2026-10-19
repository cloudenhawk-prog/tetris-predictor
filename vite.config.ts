import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { type Plugin, defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Dev-only endpoint for the workbench's game recorder: POST /__recordings/<id>
 * writes the session to recordings/<id>.json so recorded games end up next to
 * the code for later analysis.
 */
function recordingsPlugin(): Plugin {
  const dir = path.resolve(__dirname, "recordings");
  return {
    name: "game-recordings",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__recordings", (req, res) => {
        const id = decodeURIComponent((req.url ?? "").replace(/^\//, ""));
        if (req.method !== "POST" || !/^[\w-]{1,80}$/.test(id)) {
          res.statusCode = 400;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          try {
            JSON.parse(body);
          } catch {
            res.statusCode = 400;
            res.end();
            return;
          }
          mkdir(dir, { recursive: true })
            .then(() => writeFile(path.join(dir, `${id}.json`), body))
            .then(() => {
              res.statusCode = 204;
              res.end();
            })
            .catch((error: unknown) => {
              server.config.logger.error(`Saving recording ${id} failed: ${String(error)}`);
              res.statusCode = 500;
              res.end();
            });
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tsconfigPaths(), tailwindcss(), recordingsPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    // Recordings are written while the app runs; don't reload the page for them.
    watch: { ignored: ["**/recordings/**"] },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
