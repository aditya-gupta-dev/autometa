/**
 * Autometa API server entry point.
 *
 * Boots an Elysia app, mounts the Threads integration routes, and listens on
 * the port Render provides (config.port). Run with `bun run start`.
 */

import { Elysia } from "elysia";
import { config } from "./src/config";
import { threadsRoutes } from "./src/routes/threads";

const app = new Elysia()
  // Health check for Render (and uptime monitors).
  .get("/", () => ({ service: "autometa", status: "ok" }))
  .get("/health", () => ({ status: "ok" }))
  .use(threadsRoutes)
  .onError(({ code, error, set }) => {
    console.error(`[error] ${code}:`, error);
    if (code === "VALIDATION") {
      set.status = 400;
      return { error: "validation_error", message: (error as Error).message };
    }
    if (code === "NOT_FOUND") {
      set.status = 404;
      return { error: "not_found" };
    }
    set.status = 500;
    return { error: "internal_error" };
  })
  .listen({ port: config.port, hostname: "0.0.0.0" });

console.log(`🚀 autometa listening on http://${app.server?.hostname}:${app.server?.port}`);
console.log(`   OAuth redirect URI: ${config.threads.redirectUri}`);

export type App = typeof app;
