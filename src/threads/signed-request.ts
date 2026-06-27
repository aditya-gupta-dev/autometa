/**
 * Parse and verify Meta's `signed_request` payload.
 *
 * Meta posts this to the deauthorize (uninstall) and data-deletion callbacks.
 * Format: `<base64url signature>.<base64url json payload>` where the signature
 * is an HMAC-SHA256 of the raw payload string keyed by the app secret.
 *
 * Docs: https://developers.facebook.com/docs/threads/webhooks (uninstall/delete)
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config";

export interface SignedRequestPayload {
  user_id?: string;
  algorithm?: string;
  issued_at?: number;
  [key: string]: unknown;
}

function base64UrlToBuffer(input: string): Buffer {
  // Restore standard base64 padding/alphabet before decoding.
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64");
}

/**
 * Returns the verified payload, or `null` if the signature does not match
 * (in which case the request must be rejected).
 */
export function parseSignedRequest(signedRequest: string): SignedRequestPayload | null {
  const [encodedSig, encodedPayload] = signedRequest.split(".");
  if (!encodedSig || !encodedPayload) return null;

  const expected = createHmac("sha256", config.threads.appSecret)
    .update(encodedPayload)
    .digest();
  const actual = base64UrlToBuffer(encodedSig);

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  try {
    return JSON.parse(base64UrlToBuffer(encodedPayload).toString("utf8")) as SignedRequestPayload;
  } catch {
    return null;
  }
}
