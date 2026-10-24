// Cadence Realty — StatsDashboard Worker
//
// Endpoints:
//   POST /api/auth/google   { credential }      -> verify Google ID token, set session cookie
//   POST /api/auth/logout                        -> clear session cookie
//   GET  /api/session                             -> { authenticated, email }
//   GET  /api/stats                                -> PUBLIC, read-only (about.html uses this)
//   POST /api/stats          { ...fields }        -> auth required, updates the numbers
//   GET  /api/users                                -> auth required, primary + editable allowlist
//   POST /api/users          { editable: [...] }  -> auth required, up to 2 extra emails
//   GET  /api/reminders                            -> auth required, reminder config
//   POST /api/reminders      { frequency, recipients, enabled } -> auth required
//
// Scheduled handler fires daily (see wrangler.jsonc cron) and only actually
// sends an email when the configured frequency says it's due.
//
// Auth model: Google Sign-In only. Four tiers of allowed email, none of them
// passwords:
//   - env.PRIMARY_ADMIN_EMAIL    (Savannah — permanent, never removable via API)
//   - env.BUSINESS_ADMIN_EMAIL   (the business's own shared Gmail account —
//                                  also permanent and never removable via API,
//                                  but shown in the UI unlike the hidden one.
//                                  Doesn't use up one of the 2 editable slots
//                                  since it isn't a specific staff member.)
//   - KV "allowlist:editable"    (up to 2 emails Savannah can add/remove herself)
//   - env.HIDDEN_ADMIN_EMAIL     (developer's own CYA access — never returned by
//                                  any API response, never shown in the UI)

import { jwtVerify, createRemoteJWKSet } from "jose";

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs")
);
const SESSION_COOKIE = "cadence_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(data, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

// ---- session cookie: HMAC-signed "email.expiry.signature", base64url ----

function b64urlEncode(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function b64urlDecodeToBytes(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacKey(env) {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function signSession(email, env) {
  const expiry = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  // "|" is not a valid email character, unlike "." (which breaks on domains
  // like "example.com"), so it's safe as the field separator here.
  const payload = `${email}|${expiry}`;
  const key = await hmacKey(env);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );
  return `${b64urlEncode(new TextEncoder().encode(payload))}.${b64urlEncode(sig)}`;
}

async function verifySession(token, env) {
  if (!token || !token.includes(".")) return null;
  const [payloadB64, sigB64] = token.split(".");
  const payloadBytes = b64urlDecodeToBytes(payloadB64);
  const payload = new TextDecoder().decode(payloadBytes);
  const key = await hmacKey(env);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    b64urlDecodeToBytes(sigB64),
    payloadBytes
  );
  if (!valid) return null;
  const sepIndex = payload.lastIndexOf("|");
  if (sepIndex === -1) return null;
  const email = payload.slice(0, sepIndex);
  const expiry = parseInt(payload.slice(sepIndex + 1), 10);
  if (!email || !expiry || Date.now() / 1000 > expiry) return null;
  return email;
}

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

function sessionCookieHeader(value, { clear = false } = {}) {
  const maxAge = clear ? 0 : SESSION_TTL_SECONDS;
  const v = clear ? "" : value;
  return `${SESSION_COOKIE}=${v}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=None`;
}

async function requireAuth(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  const email = await verifySession(token, env);
  return email; // null if not authenticated
}

async function isAllowedEmail(email, env) {
  if (!email) return false;
  const lower = email.toLowerCase();
  if (lower === (env.PRIMARY_ADMIN_EMAIL || "").toLowerCase()) return true;
  if (lower === (env.BUSINESS_ADMIN_EMAIL || "").toLowerCase()) return true;
  if (lower === (env.HIDDEN_ADMIN_EMAIL || "").toLowerCase()) return true;
  const raw = await env.STATS_KV.get("allowlist:editable");
  const list = raw ? JSON.parse(raw) : [];
  return list.some((u) => u.email.toLowerCase() === lower);
}

// ---- route handlers ----

async function handleGoogleAuth(request, env) {
  const { credential } = await request.json().catch(() => ({}));
  if (!credential) return json({ error: "Missing credential" }, { status: 400 });

  let payload;
  try {
    const result = await jwtVerify(credential, GOOGLE_JWKS, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: env.GOOGLE_CLIENT_ID,
    });
    payload = result.payload;
  } catch (err) {
    return json({ error: "Invalid Google token" }, { status: 401 });
  }

  if (!payload.email || payload.email_verified !== true) {
    return json({ error: "Google account email not verified" }, { status: 401 });
  }

  const allowed = await isAllowedEmail(payload.email, env);
  if (!allowed) {
    return json(
      { error: "This Google account is not authorized for the dashboard" },
      { status: 403 }
    );
  }

  const cookieValue = await signSession(payload.email, env);
  return json(
    { ok: true, email: payload.email },
    { headers: { "Set-Cookie": sessionCookieHeader(cookieValue) } }
  );
}

function handleLogout() {
  return json({ ok: true }, { headers: { "Set-Cookie": sessionCookieHeader(null, { clear: true }) } });
}

async function handleSession(request, env) {
  const email = await requireAuth(request, env);
  return json({ authenticated: !!email, email: email || null });
}

const DEFAULT_STATS = {
  valueSold: 0,
  propertiesSold: 0,
  averagePrice: 0,
  periodLabel: "Trailing 12 months",
  methodology: "Manually entered by brokerage staff",
  methodologyNote: "",
  lastUpdated: null,
  updatedBy: null,
};

async function handleGetStats(env) {
  const raw = await env.STATS_KV.get("stats:current");
  const data = raw ? JSON.parse(raw) : DEFAULT_STATS;
  return json(data);
}

async function handlePostStats(request, env, email) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "Invalid JSON" }, { status: 400 });

  const next = {
    valueSold: Number(body.valueSold) || 0,
    propertiesSold: Number(body.propertiesSold) || 0,
    averagePrice: Number(body.averagePrice) || 0,
    periodLabel: String(body.periodLabel || DEFAULT_STATS.periodLabel).slice(0, 120),
    methodology: String(body.methodology || DEFAULT_STATS.methodology).slice(0, 200),
    methodologyNote: String(body.methodologyNote || "").slice(0, 300),
    lastUpdated: new Date().toISOString(),
    updatedBy: email,
  };

  await env.STATS_KV.put("stats:current", JSON.stringify(next));
  return json({ ok: true, stats: next });
}

async function handleGetUsers(env) {
  const raw = await env.STATS_KV.get("allowlist:editable");
  const editable = raw ? JSON.parse(raw) : [];
  return json({ primary: env.PRIMARY_ADMIN_EMAIL, business: env.BUSINESS_ADMIN_EMAIL, editable });
  // Note: HIDDEN_ADMIN_EMAIL is intentionally never included in any response.
}

async function handlePostUsers(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.editable)) {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }

  const primaryLower = (env.PRIMARY_ADMIN_EMAIL || "").toLowerCase();
  const businessLower = (env.BUSINESS_ADMIN_EMAIL || "").toLowerCase();
  const hiddenLower = (env.HIDDEN_ADMIN_EMAIL || "").toLowerCase();

  const cleaned = body.editable
    .map((u) => ({ email: String(u.email || "").trim().toLowerCase(), label: String(u.label || "").slice(0, 60) }))
    .filter((u) => u.email && u.email !== primaryLower && u.email !== businessLower && u.email !== hiddenLower)
    .slice(0, 2);

  await env.STATS_KV.put("allowlist:editable", JSON.stringify(cleaned));
  return json({ ok: true, editable: cleaned });
}

const DEFAULT_REMINDERS = {
  frequency: "monthly", // "weekly" | "biweekly" | "monthly"
  recipients: [],
  enabled: false,
  lastSentDate: null,
};

async function handleGetReminders(env) {
  const raw = await env.STATS_KV.get("config:reminders");
  const data = raw ? JSON.parse(raw) : DEFAULT_REMINDERS;
  return json(data);
}

async function handlePostReminders(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "Invalid JSON" }, { status: 400 });

  const current = JSON.parse(
    (await env.STATS_KV.get("config:reminders")) || JSON.stringify(DEFAULT_REMINDERS)
  );

  const next = {
    ...current,
    frequency: ["weekly", "biweekly", "monthly"].includes(body.frequency)
      ? body.frequency
      : current.frequency,
    recipients: Array.isArray(body.recipients)
      ? body.recipients
          .map((e) => String(e).trim())
          .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
          .slice(0, 10)
      : current.recipients,
    enabled: typeof body.enabled === "boolean" ? body.enabled : current.enabled,
  };

  await env.STATS_KV.put("config:reminders", JSON.stringify(next));
  return json({ ok: true, reminders: next });
}

// ---- main fetch handler ----

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = corsHeaders(env);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    try {
      let response;

      if (url.pathname === "/api/auth/google" && request.method === "POST") {
        response = await handleGoogleAuth(request, env);
      } else if (url.pathname === "/api/auth/logout" && request.method === "POST") {
        response = handleLogout();
      } else if (url.pathname === "/api/session" && request.method === "GET") {
        response = await handleSession(request, env);
      } else if (url.pathname === "/api/stats" && request.method === "GET") {
        response = await handleGetStats(env);
      } else if (url.pathname === "/api/stats" && request.method === "POST") {
        const email = await requireAuth(request, env);
        response = email
          ? await handlePostStats(request, env, email)
          : json({ error: "Not authenticated" }, { status: 401 });
      } else if (url.pathname === "/api/users" && request.method === "GET") {
        const email = await requireAuth(request, env);
        response = email ? await handleGetUsers(env) : json({ error: "Not authenticated" }, { status: 401 });
      } else if (url.pathname === "/api/users" && request.method === "POST") {
        const email = await requireAuth(request, env);
        response = email ? await handlePostUsers(request, env) : json({ error: "Not authenticated" }, { status: 401 });
      } else if (url.pathname === "/api/reminders" && request.method === "GET") {
        const email = await requireAuth(request, env);
        response = email ? await handleGetReminders(env) : json({ error: "Not authenticated" }, { status: 401 });
      } else if (url.pathname === "/api/reminders" && request.method === "POST") {
        const email = await requireAuth(request, env);
        response = email ? await handlePostReminders(request, env) : json({ error: "Not authenticated" }, { status: 401 });
      } else {
        response = json({ error: "Not found" }, { status: 404 });
      }

      const merged = new Headers(response.headers);
      for (const [k, v] of Object.entries(headers)) merged.set(k, v);
      return new Response(response.body, { status: response.status, headers: merged });
    } catch (err) {
      return json({ error: "Internal error" }, { status: 500, headers });
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminderCheck(env));
  },
};

// ---- scheduled reminder email ----

function isDue(frequency, lastSentDate) {
  if (!lastSentDate) return true;
  const last = new Date(lastSentDate);
  const days = (Date.now() - last.getTime()) / (1000 * 60 * 60 * 24);
  if (frequency === "weekly") return days >= 7;
  if (frequency === "biweekly") return days >= 14;
  return days >= 28; // monthly
}

async function runReminderCheck(env) {
  const reminders = JSON.parse(
    (await env.STATS_KV.get("config:reminders")) || JSON.stringify(DEFAULT_REMINDERS)
  );
  if (!reminders.enabled || reminders.recipients.length === 0) return;
  if (!isDue(reminders.frequency, reminders.lastSentDate)) return;

  const stats = JSON.parse((await env.STATS_KV.get("stats:current")) || JSON.stringify(DEFAULT_STATS));

  const dashboardUrl = env.DASHBOARD_URL || "https://bcreativeservices.github.io/cadence-reality-website/stats-dashboard.html";
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(dashboardUrl)}`;

  const lastUpdatedText = stats.lastUpdated
    ? new Date(stats.lastUpdated).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : "never";

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color:#1a1a1a;">Time to update your website stats</h2>
      <p>Here are the numbers currently showing on the Cadence Realty Services website:</p>
      <ul style="line-height:1.8;">
        <li><strong>Value of Real Estate Sold:</strong> $${Number(stats.valueSold).toLocaleString()}</li>
        <li><strong>Properties Sold:</strong> ${Number(stats.propertiesSold).toLocaleString()}</li>
        <li><strong>Average Price:</strong> $${Number(stats.averagePrice).toLocaleString()}</li>
      </ul>
      <p><strong>Last updated:</strong> ${lastUpdatedText}</p>
      <p>Scan this code on your phone, or click the link below, to update the numbers:</p>
      <img src="${qrUrl}" alt="QR code to the stats dashboard" width="200" height="200" />
      <p><a href="${dashboardUrl}">${dashboardUrl}</a></p>
    </div>
  `;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.REMINDER_FROM_EMAIL || "Cadence Stats Dashboard <onboarding@resend.dev>",
      to: reminders.recipients,
      subject: "Reminder: update your Cadence Realty website stats",
      html,
    }),
  });

  await env.STATS_KV.put(
    "config:reminders",
    JSON.stringify({ ...reminders, lastSentDate: new Date().toISOString() })
  );
}
