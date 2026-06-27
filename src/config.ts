/**
 * Centralized environment configuration.
 *
 * Bun automatically loads `.env`, so we just read from `process.env` here.
 * Required values throw at startup if missing, so misconfiguration fails fast
 * instead of surfacing as a confusing OAuth error later.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

/**
 * Public HTTPS base URL of this deployment (e.g. https://autometa.onrender.com).
 * Meta builds/validates the OAuth redirect_uri against this, so it must exactly
 * match what is registered in the Meta dashboard. No trailing slash.
 */
const appUrl = required("APP_URL").replace(/\/+$/, "");

export const config = {
  /** Port to bind. Render injects PORT; default to 3000 locally. */
  port: Number(optional("PORT", "3000")),

  appUrl,

  threads: {
    appId: required("THREADS_APP_ID"),
    appSecret: required("THREADS_APP_SECRET"),

    /** Shared secret used for the webhook verification handshake with Meta. */
    webhookVerifyToken: required("THREADS_WEBHOOK_VERIFY_TOKEN"),

    /**
     * OAuth scopes requested during authorization. Mirrors the permissions in
     * THREADS_API_SETUP.md (§5). `threads_basic` is always required.
     */
    scopes: [
      "threads_basic",
      "threads_content_publish",
      "threads_manage_insights",
      "threads_manage_replies",
      "threads_read_replies",
      "threads_delete",
    ],

    /** OAuth redirect target. Must be registered in Meta (§6). */
    get redirectUri() {
      return `${appUrl}/threads/callback`;
    },

    // Threads Graph API hosts.
    authBaseUrl: "https://threads.net",
    graphBaseUrl: "https://graph.threads.net",
    apiVersion: "v1.0",
  },

  /**
   * SQLite database path. On Render, point this at a mounted persistent disk
   * (e.g. /var/data/autometa.db) so tokens survive restarts/redeploys.
   */
  databasePath: optional("DATABASE_PATH", "autometa.db"),
} as const;

export type Config = typeof config;
