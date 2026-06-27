# Threads API Setup Guide for Mixpost

A complete, step-by-step guide to connecting Threads accounts to Mixpost — covering the cloud server and domain, the Meta/Threads app configuration, the Mixpost service form, and the optional Engagement (webhooks) for the Inbox.

---

## Table of Contents

1. [Prerequisites & Key Concepts](#1-prerequisites--key-concepts)
2. [Set Up a Server with a Domain](#2-set-up-a-server-with-a-domain)
3. [Create a Facebook Developer Account](#3-create-a-facebook-developer-account)
4. [Create a New App](#4-create-a-new-app)
5. [Add Permissions](#5-add-permissions)
6. [Configure Redirect URLs](#6-configure-redirect-urls)
7. [Copy Credentials into Mixpost](#7-copy-credentials-into-mixpost)
8. [Add Threads Testers](#8-add-threads-testers)
9. [Finish Customization](#9-finish-customization)
10. [Configure the Engagement / Webhooks (Optional)](#10-configure-the-engagement--webhooks-optional)
11. [Connect a Threads Account & Test](#11-connect-a-threads-account--test)
12. [Troubleshooting](#12-troubleshooting)
13. [Quick Reference](#13-quick-reference)

---

## 1. Prerequisites & Key Concepts

### What you actually need

You do **not** need a "production" public-facing product. You **do** need a **publicly reachable HTTPS URL** with a valid TLS certificate. Meta enforces this for two reasons:

- **OAuth redirect** — Meta only accepts `https://` redirect URIs. `localhost` / `127.0.0.1` is **not** accepted for Threads OAuth.
- **Webhooks (Engagement)** — Meta's servers call *into* your app to verify the callback and deliver replies/mentions. The URL must be reachable from the public internet.

### Two ways to get a public HTTPS URL

| Option | Best for | Notes |
|--------|----------|-------|
| **Cloud server + domain** (recommended) | Anything beyond a quick test; required for webhooks | Stable URL, register once. Covered in [Step 2](#2-set-up-a-server-with-a-domain). |
| **Tunnel** (ngrok, Cloudflare Tunnel) | Quick local dev / OAuth-only testing | Free ngrok URLs rotate on restart → you must re-register URLs each time. |

This guide assumes the **cloud server + domain** route.

### The `MIXPOST_CORE_PATH` placeholder

Every callback URL below contains `<MIXPOST_CORE_PATH>`. Replace it with the value of your `MIXPOST_CORE_PATH` env variable. **Default: `mixpost`.** For the Lite package, use `mixpost` (only if Threads is supported in Lite).

Throughout this guide, replace:
- `example.com` → your real domain (e.g. `mixpost.yourdomain.com`)
- `<MIXPOST_CORE_PATH>` → your core path (default `mixpost`)

---

## 2. Set Up a Server with a Domain

> Skip this section if you already have Mixpost running on a public HTTPS domain.

### 2.1 Provision a server

- A small VPS (1–2 GB RAM minimum) from any provider (DigitalOcean, Hetzner, Linode, AWS Lightsail, etc.).
- Mixpost requires: a web server (nginx/Caddy), PHP, a database (MySQL/MariaDB or PostgreSQL), **Redis**, a **queue worker**, and the **scheduler** (cron). Follow the official Mixpost installation docs for the full stack.

### 2.2 Point a domain at the server

- Create an **A record** for your domain or subdomain pointing to the server's public IP.
  - Example: `mixpost.yourdomain.com → 203.0.113.10`
- Wait for DNS to propagate (usually minutes).

### 2.3 Enable HTTPS with a trusted certificate

Meta **rejects self-signed certificates.** Use a publicly trusted cert:

- **Caddy** — issues and renews Let's Encrypt certs automatically (easiest).
- **nginx + certbot** — `certbot --nginx -d mixpost.yourdomain.com`.

Open ports **80** and **443** in the firewall:
- `443` — HTTPS traffic.
- `80` — required for the Let's Encrypt HTTP challenge and HTTP→HTTPS redirect.

### 2.4 Configure Mixpost's `APP_URL`

In your Mixpost `.env`, set the app URL to the public HTTPS domain. **This is critical** — Mixpost builds the OAuth `redirect_uri` from this value, and it must exactly match what you register in the Meta dashboard.

```env
APP_URL=https://mixpost.yourdomain.com
# Optional, only if you customized the core path:
# MIXPOST_CORE_PATH=mixpost
```

If `APP_URL` is wrong (e.g. `http://` or `localhost`), OAuth fails with a **redirect URI mismatch** error.

### 2.5 Verify

Browse to `https://mixpost.yourdomain.com` and confirm:
- The site loads over HTTPS with a valid (green padlock) certificate.
- No mixed-content or cert warnings.

---

## 3. Create a Facebook Developer Account

To create a Threads application you need a Facebook developer account.

1. Go to the [Facebook for Developers](https://developers.facebook.com/) website.
2. Click **Get Started** in the top-right corner.
3. Follow the prompts to sign up for a developer account.

---

## 4. Create a New App

> **Tip:** If you already have a Facebook application, reuse it for Threads instead of creating a separate app.

1. Go to the [Facebook Developer Dashboard](https://developers.facebook.com/apps/).
2. Click **Create App** in the top-right corner.
3. Enter your **application's name** and your **email address**.
4. Select **Access the Threads API** as the use case.
5. Select a **business portfolio** (optional).
6. Review the details and click **Create app**.

---

## 5. Add Permissions

1. Click the **Use cases** link in the right menu.
2. Click the **Customize** button on the **"Access the Threads API"** use case.
3. Add the following permissions:
   - `threads_content_publish`
   - `threads_manage_insights`
   - `threads_manage_replies`
   - `threads_read_replies`
   - `threads_delete`

> The `threads_manage_replies` and `threads_read_replies` permissions are required for reply webhooks (Engagement). Without them, reply webhooks are not delivered.

---

## 6. Configure Redirect URLs

1. Click the **Use cases** link in the right menu.
2. Click **Customize** on the **"Access the Threads API"** use case.
3. Click the **Settings** link in the right menu of the "Access the Threads API" sidebar.
4. In the **Redirect Callback URLs** field, enter:

   ```
   https://example.com/<MIXPOST_CORE_PATH>/callback/threads
   ```

   > ⚠️ **Important:** When you enter the URL, a dropdown appears beneath it. You **must click the dropdown entry** to select the URL. Just typing it will **not** work.

5. In the **Uninstall Callback URL** and **Delete Callback URL** fields, enter:

   ```
   https://example.com/<MIXPOST_CORE_PATH>/uninstall-callback/threads
   ```

6. **Save** the changes.

**Example with real values** (domain `mixpost.yourdomain.com`, default core path `mixpost`):

| Field | URL |
|-------|-----|
| Redirect Callback URL | `https://mixpost.yourdomain.com/mixpost/callback/threads` |
| Uninstall Callback URL | `https://mixpost.yourdomain.com/mixpost/uninstall-callback/threads` |
| Delete Callback URL | `https://mixpost.yourdomain.com/mixpost/uninstall-callback/threads` |

---

## 7. Copy Credentials into Mixpost

1. On the app's **Dashboard** page, locate the **Threads App ID** and the hidden **Threads App secret**.
2. Copy both credentials.
3. Open the **Threads third-party service form** in your Mixpost dashboard.
4. Paste the App ID and App secret into the form and save.

**Where to find the service form in Mixpost:**

- **Pro / Enterprise & Lite:** Open the **User Menu** at the bottom left → **Admin Console** → **Services** (left sidebar) → **Threads**.

---

## 8. Add Threads Testers

Threads apps in development mode can only connect accounts that are registered as testers.

### 8.1 Add a tester

1. Click **App Roles → Roles** in the right menu.
2. Click **Add People**.
3. Select **Threads Tester**.
4. Enter the Threads username and choose it from the list.
5. Click **Add**.

### 8.2 Accept the invitation (done by the tester account)

1. Go to your **Threads Account Settings** page.
2. Select **Website permissions**.
3. Navigate to the **Invites** tab.
4. Find your Threads application and **accept** the invitation.

---

## 9. Finish Customization

1. Click the **Dashboard** link in the right menu.
2. Select **Finish customization**.
3. Confirm by clicking **Yes, I'm finished**.

---

## 10. Configure the Engagement / Webhooks (Optional)

The Engagement brings Threads **replies** (comments on your posts) and **mentions** into Mixpost's **Inbox** in real time, delivered via Meta webhooks. Unlike Facebook and Instagram, Threads webhooks are configured **once at the app level** — there is no per-account subscription.

> The Engagement must be **enabled in your Mixpost installation** for the **Webhook Verify Token** field and the `inbox-webhook` endpoint to be available.

### 10.1 Set a Webhook Verify Token in Mixpost

1. Open the **Threads third-party service form** in Mixpost (same form as [Step 7](#7-copy-credentials-into-mixpost)).
2. In the **Webhook Verify Token** field, click **generate** (or enter your own random string). This is a shared secret Meta sends back during the handshake.
3. **Save** the service.

### 10.2 Add the webhook in the Meta dashboard

1. In the Facebook Developer Dashboard, open your app.
2. Click **Use cases** → **Customize** on **"Access the Threads API"**.
3. Open the **Webhooks** section.
4. Set the **Callback URL** to:

   ```
   https://example.com/<MIXPOST_CORE_PATH>/inbox-webhook/threads
   ```

   Example: `https://mixpost.yourdomain.com/mixpost/inbox-webhook/threads`

5. Set the **Verify token** to the **exact same value** you saved in Mixpost in step 10.1.
6. Click **Verify and save**. Meta calls your callback URL to confirm the token matches.

### 10.3 Subscribe to the webhook fields

After the callback is verified, subscribe to:

- **`replies`** — replies/comments on your Threads posts.
- **`mentions`** — posts that mention your connected account.

> Ensure the `threads_manage_replies` and `threads_read_replies` permissions ([Step 5](#5-add-permissions)) are added — without them, reply webhooks are not delivered.

---

## 11. Connect a Threads Account & Test

1. In Mixpost, navigate to a **workspace**.
2. Select **Social Accounts** from the left sidebar.
3. Click **Add Account** and choose **Threads**.
4. Complete the OAuth flow (the account must be a registered tester from [Step 8](#8-add-threads-testers)).
5. Schedule a test post to confirm publishing works.
6. If Engagement is configured, reply to one of your posts from another account and confirm it appears in the Mixpost **Inbox**.

---

## 12. Troubleshooting

| Symptom | Likely cause & fix |
|---------|-------------------|
| **"Invalid redirect URI" / mismatch** | `APP_URL` in Mixpost doesn't match the registered redirect URL. Ensure it's `https://`, the correct domain, and the right core path. |
| **OAuth fails for your account** | The Threads account isn't a registered & accepted tester (Step 8), or the app isn't finished (Step 9). |
| **Redirect URL won't save in Meta** | You typed the URL but didn't click the dropdown entry that appears under the field. Re-enter and select it. |
| **Webhook "Verify and save" fails** | Verify token mismatch, the URL isn't publicly reachable, or TLS is self-signed/invalid. Confirm the token is identical on both sides and the domain serves a trusted cert. |
| **Replies don't appear in Inbox** | Missing `threads_manage_replies` / `threads_read_replies` permissions, fields not subscribed (Step 10.3), or Engagement not enabled in Mixpost. |
| **Cert errors from Meta** | Self-signed certs are rejected. Use Let's Encrypt (Caddy or certbot). |
| **Callback unreachable** | Ports 80/443 not open, DNS not propagated, or queue worker/web server not running. |

---

## 13. Quick Reference

**Replace** `example.com` → your domain, `<MIXPOST_CORE_PATH>` → your core path (default `mixpost`).

### URLs to register in Meta

```
Redirect Callback:   https://example.com/<MIXPOST_CORE_PATH>/callback/threads
Uninstall Callback:  https://example.com/<MIXPOST_CORE_PATH>/uninstall-callback/threads
Delete Callback:     https://example.com/<MIXPOST_CORE_PATH>/uninstall-callback/threads
Webhook Callback:    https://example.com/<MIXPOST_CORE_PATH>/inbox-webhook/threads
```

### Permissions to add

```
threads_content_publish
threads_manage_insights
threads_manage_replies
threads_read_replies
threads_delete
```

### Webhook fields to subscribe

```
replies
mentions
```

### Mixpost `.env`

```env
APP_URL=https://mixpost.yourdomain.com
# MIXPOST_CORE_PATH=mixpost   # only if customized
```

### Requirements checklist

- [ ] Public domain with A record → server IP
- [ ] Valid (non-self-signed) TLS certificate
- [ ] Ports 80 & 443 open
- [ ] `APP_URL` set to the public HTTPS domain
- [ ] Threads App ID & secret pasted into Mixpost
- [ ] All 5 permissions added
- [ ] Redirect URLs registered (dropdown selected!)
- [ ] Threads account added & accepted as tester
- [ ] App customization finished
- [ ] (Optional) Webhook verify token matched & fields subscribed
