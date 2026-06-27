/**
 * Threads integration routes, grouped under `/threads`.
 *
 * Endpoints (register the public HTTPS forms of these in the Meta dashboard,
 * see THREADS_API_SETUP.md):
 *
 *   GET  /threads/connect              -> start OAuth (redirects to Meta)
 *   GET  /threads/callback             -> OAuth redirect callback
 *   POST /threads/uninstall-callback   -> Meta deauthorize (signed_request)
 *   POST /threads/delete-callback      -> Meta data deletion (signed_request)
 *   GET  /threads/webhook              -> webhook verification handshake
 *   POST /threads/webhook              -> webhook event delivery (replies/mentions)
 *   GET  /threads/accounts             -> list connected accounts
 *   POST /threads/publish              -> publish a post
 */

import { Elysia, t } from "elysia";
import { randomBytes } from "node:crypto";
import { config } from "../config";
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  getProfile,
  publishPost,
} from "../threads/client";
import { parseSignedRequest } from "../threads/signed-request";
import { deleteAccount, getAccount, listAccounts, saveAccount } from "../db";

/**
 * In-memory OAuth `state` store for CSRF protection. States are short-lived
 * and single-use; a Map is fine for a single instance. (For multi-instance
 * deployments, back this with Redis or the DB instead.)
 */
const pendingStates = new Map<string, number>();
const STATE_TTL_MS = 10 * 60 * 1000;

function issueState(): string {
  const state = randomBytes(16).toString("hex");
  pendingStates.set(state, Date.now());
  return state;
}

function consumeState(state: string): boolean {
  const issuedAt = pendingStates.get(state);
  if (issuedAt === undefined) return false;
  pendingStates.delete(state);
  return Date.now() - issuedAt <= STATE_TTL_MS;
}

export const threadsRoutes = new Elysia({ prefix: "/threads" })
  // --- OAuth: start ---------------------------------------------------------
  .get("/connect", ({ redirect }) => {
    return redirect(buildAuthorizeUrl(issueState()));
  })

  // --- OAuth: redirect callback --------------------------------------------
  .get(
    "/callback",
    async ({ query, set }) => {
      // Meta returns an `error` query param if the user denied access.
      if (query.error) {
        set.status = 400;
        return { error: query.error, description: query.error_description };
      }
      if (!query.code || !query.state) {
        set.status = 400;
        return { error: "missing_code_or_state" };
      }
      if (!consumeState(query.state)) {
        set.status = 400;
        return { error: "invalid_state" };
      }

      try {
        const short = await exchangeCodeForToken(query.code);
        const long = await exchangeForLongLivedToken(short.access_token);

        let username: string | null = null;
        try {
          username = (await getProfile(short.user_id, long.access_token)).username ?? null;
        } catch {
          // Profile fetch is best-effort; the token is what matters.
        }

        saveAccount({
          userId: short.user_id,
          username,
          accessToken: long.access_token,
          expiresInSeconds: long.expires_in,
        });

        return {
          connected: true,
          user_id: short.user_id,
          username,
          token_expires_in_days: Math.round(long.expires_in / 86400),
        };
      } catch (err) {
        set.status = 502;
        return { error: "oauth_exchange_failed", message: (err as Error).message };
      }
    },
    {
      query: t.Object({
        code: t.Optional(t.String()),
        state: t.Optional(t.String()),
        error: t.Optional(t.String()),
        error_description: t.Optional(t.String()),
      }),
    },
  )

  // --- Deauthorize (uninstall) callback ------------------------------------
  .post(
    "/uninstall-callback",
    ({ body, set }) => {
      const payload = body.signed_request ? parseSignedRequest(body.signed_request) : null;
      if (!payload) {
        set.status = 400;
        return { error: "invalid_signed_request" };
      }
      if (payload.user_id) deleteAccount(payload.user_id);
      return { success: true };
    },
    { body: t.Object({ signed_request: t.Optional(t.String()) }) },
  )

  // --- Data deletion callback ----------------------------------------------
  // Meta expects a JSON body with a confirmation URL and code.
  .post(
    "/delete-callback",
    ({ body, set }) => {
      const payload = body.signed_request ? parseSignedRequest(body.signed_request) : null;
      if (!payload) {
        set.status = 400;
        return { error: "invalid_signed_request" };
      }
      if (payload.user_id) deleteAccount(payload.user_id);
      const confirmationCode = payload.user_id ?? randomBytes(8).toString("hex");
      return {
        url: `${config.appUrl}/threads/deletion-status?code=${confirmationCode}`,
        confirmation_code: confirmationCode,
      };
    },
    { body: t.Object({ signed_request: t.Optional(t.String()) }) },
  )

  // --- Webhook: verification handshake (GET) -------------------------------
  .get(
    "/webhook",
    ({ query, set }) => {
      if (
        query["hub.mode"] === "subscribe" &&
        query["hub.verify_token"] === config.threads.webhookVerifyToken
      ) {
        // Meta requires the raw challenge echoed back as text/plain.
        set.headers["content-type"] = "text/plain";
        return query["hub.challenge"] ?? "";
      }
      set.status = 403;
      return "Forbidden";
    },
    {
      query: t.Object({
        "hub.mode": t.Optional(t.String()),
        "hub.verify_token": t.Optional(t.String()),
        "hub.challenge": t.Optional(t.String()),
      }),
    },
  )

  // --- Webhook: event delivery (POST) --------------------------------------
  .post("/webhook", ({ body }) => {
    // Replies / mentions land here. Meta expects a fast 200; do heavy work async.
    console.log("[threads webhook]", JSON.stringify(body));
    return new Response("EVENT_RECEIVED", { status: 200 });
  })

  // --- List connected accounts ---------------------------------------------
  .get("/accounts", () =>
    listAccounts().map((a) => ({
      user_id: a.user_id,
      username: a.username,
      token_expires_at: a.token_expires_at,
    })),
  )

  // --- Publish a post -------------------------------------------------------
  .post(
    "/publish",
    async ({ body, set }) => {
      const account = getAccount(body.user_id);
      if (!account) {
        set.status = 404;
        return { error: "account_not_connected" };
      }
      if (!body.text && !body.image_url && !body.video_url) {
        set.status = 400;
        return { error: "empty_post" };
      }
      try {
        const result = await publishPost(account.user_id, account.access_token, {
          text: body.text,
          imageUrl: body.image_url,
          videoUrl: body.video_url,
        });
        return { published: true, id: result.id };
      } catch (err) {
        set.status = 502;
        return { error: "publish_failed", message: (err as Error).message };
      }
    },
    {
      body: t.Object({
        user_id: t.String(),
        text: t.Optional(t.String()),
        image_url: t.Optional(t.String()),
        video_url: t.Optional(t.String()),
      }),
    },
  );
