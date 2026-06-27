/**
 * Thin client over the Threads Graph API.
 *
 * Covers the pieces our endpoints need:
 *   - OAuth: build the authorize URL, exchange code -> short-lived token,
 *     upgrade short-lived -> long-lived token, refresh a long-lived token.
 *   - Profile lookup.
 *   - Publishing (the two-step create-container -> publish flow).
 *
 * Docs: https://developers.facebook.com/docs/threads
 */

import { config } from "../config";

const { threads } = config;
const GRAPH = `${threads.graphBaseUrl}/${threads.apiVersion}`;

/** Build the URL we redirect the user to in order to start the OAuth flow. */
export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: threads.appId,
    redirect_uri: threads.redirectUri,
    scope: threads.scopes.join(","),
    response_type: "code",
    state,
  });
  return `${threads.authBaseUrl}/oauth/authorize?${params.toString()}`;
}

interface ShortLivedToken {
  access_token: string;
  user_id: string;
}

/** Exchange the OAuth `code` for a short-lived access token (~1 hour). */
export async function exchangeCodeForToken(code: string): Promise<ShortLivedToken> {
  const body = new URLSearchParams({
    client_id: threads.appId,
    client_secret: threads.appSecret,
    grant_type: "authorization_code",
    redirect_uri: threads.redirectUri,
    code,
  });

  const res = await fetch(`${threads.graphBaseUrl}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = (await res.json()) as ShortLivedToken & { error_message?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`Token exchange failed: ${data.error_message ?? JSON.stringify(data)}`);
  }
  // user_id can come back as a number; normalize to string.
  return { access_token: data.access_token, user_id: String(data.user_id) };
}

interface LongLivedToken {
  access_token: string;
  token_type: string;
  expires_in: number; // seconds (~60 days)
}

/** Upgrade a short-lived token to a long-lived one (valid ~60 days). */
export async function exchangeForLongLivedToken(shortLivedToken: string): Promise<LongLivedToken> {
  const params = new URLSearchParams({
    grant_type: "th_exchange_token",
    client_secret: threads.appSecret,
    access_token: shortLivedToken,
  });

  const res = await fetch(`${threads.graphBaseUrl}/access_token?${params.toString()}`);
  const data = (await res.json()) as LongLivedToken & { error?: { message?: string } };
  if (!res.ok || !data.access_token) {
    throw new Error(`Long-lived token exchange failed: ${data.error?.message ?? JSON.stringify(data)}`);
  }
  return data;
}

/** Refresh a long-lived token (must be at least 24h old, unexpired). */
export async function refreshLongLivedToken(longLivedToken: string): Promise<LongLivedToken> {
  const params = new URLSearchParams({
    grant_type: "th_refresh_token",
    access_token: longLivedToken,
  });

  const res = await fetch(`${threads.graphBaseUrl}/refresh_access_token?${params.toString()}`);
  const data = (await res.json()) as LongLivedToken & { error?: { message?: string } };
  if (!res.ok || !data.access_token) {
    throw new Error(`Token refresh failed: ${data.error?.message ?? JSON.stringify(data)}`);
  }
  return data;
}

interface ThreadsProfile {
  id: string;
  username?: string;
  name?: string;
  threads_profile_picture_url?: string;
}

/** Fetch the connected user's profile (used to store their @username). */
export async function getProfile(userId: string, accessToken: string): Promise<ThreadsProfile> {
  const params = new URLSearchParams({
    fields: "id,username,name,threads_profile_picture_url",
    access_token: accessToken,
  });
  const res = await fetch(`${GRAPH}/${userId}?${params.toString()}`);
  const data = (await res.json()) as ThreadsProfile & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(`Profile fetch failed: ${data.error?.message ?? JSON.stringify(data)}`);
  }
  return data;
}

export interface PublishOptions {
  text?: string;
  /** Public URL of an image to attach (Threads must be able to fetch it). */
  imageUrl?: string;
  /** Public URL of a video to attach. */
  videoUrl?: string;
}

/**
 * Publish a single post using the two-step flow:
 *   1. Create a media container.
 *   2. Publish that container.
 * Returns the published media id.
 */
export async function publishPost(
  userId: string,
  accessToken: string,
  options: PublishOptions,
): Promise<{ id: string }> {
  const mediaType = options.videoUrl ? "VIDEO" : options.imageUrl ? "IMAGE" : "TEXT";

  // Step 1: create container.
  const createParams = new URLSearchParams({ media_type: mediaType, access_token: accessToken });
  if (options.text) createParams.set("text", options.text);
  if (options.imageUrl) createParams.set("image_url", options.imageUrl);
  if (options.videoUrl) createParams.set("video_url", options.videoUrl);

  const createRes = await fetch(`${GRAPH}/${userId}/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: createParams,
  });
  const createData = (await createRes.json()) as { id?: string; error?: { message?: string } };
  if (!createRes.ok || !createData.id) {
    throw new Error(`Create container failed: ${createData.error?.message ?? JSON.stringify(createData)}`);
  }

  // Step 2: publish container.
  const publishParams = new URLSearchParams({
    creation_id: createData.id,
    access_token: accessToken,
  });
  const publishRes = await fetch(`${GRAPH}/${userId}/threads_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: publishParams,
  });
  const publishData = (await publishRes.json()) as { id?: string; error?: { message?: string } };
  if (!publishRes.ok || !publishData.id) {
    throw new Error(`Publish failed: ${publishData.error?.message ?? JSON.stringify(publishData)}`);
  }
  return { id: publishData.id };
}
