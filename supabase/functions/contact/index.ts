// ============================================================
// TutorEnglishPro - Contact Form (Supabase Edge Function)
// ------------------------------------------------------------
// Public contact form (no login required). Stores the message in
// the `contacts` table and emails Ahmed. Returns instantly.
//
//  - POST {name, email, message} -> inserts + notifies staff.
//
// SECURITY: verify_jwt = false (guests may contact). Writes go
// through the service_role key. RLS still allows anon INSERT into
// `contacts`, but the function is authoritative so we keep all
// writes server-side.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_SERVICE = Deno.env.get("SERVICE_ROLE_KEY") || "";
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") || "";
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") || "TutorEnglishPro <onboarding@resend.dev>";
const SITE_URL = Deno.env.get("SITE_URL") || "https://www.proenglishtutor.online";

const supabase = createClient(SB_URL, SB_SERVICE);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(status, body, statusCode = 200) {
  return new Response(JSON.stringify({ status, ...body }), {
    status: statusCode,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(e) {
  return typeof e === "string" && e.trim().length <= 254 && emailRe.test(e.trim());
}

function escHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeTitle(t) {
  return String(t || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// In-memory rate limiter for the public write path.
const recent = new Map();
function rateLimited(key) {
  const now = Date.now();
  const list = (recent.get(key) || []).filter(t => now - t < 60000);
  if (list.length >= 6) return true;
  list.push(now);
  recent.set(key, list);
  return false;
}

async function notifyStaff(submission) {
  if (!RESEND_KEY) {
    console.log("[contact] email skipped (no RESEND_API_KEY)");
    return "skipped";
  }
  const { data: staff } = await supabase
    .from("profiles")
    .select("email")
    .in("role", ["admin", "staff"]);
  const targets = (staff || [])
    .map(a => a.email)
    .filter(e => e && /@/.test(e));
  if (!targets.length) return "no-staff";

  const html = `
    <p style="margin:0 0 12px;color:#111;font-size:15px;">
      <strong>${escHtml(submission.name || "Someone")}</strong> submitted the contact form:
    </p>
    <div style="background:#f3fbf6;border:1px solid #d8efdf;border-radius:10px;padding:14px;color:#111;font-size:15px;white-space:pre-wrap;">${escHtml(submission.message)}</div>
    <p style="margin:16px 0 20px;color:#6b7280;font-size:13px;">
      Email: ${escHtml(submission.email || "")}<br>
      Sent: ${escHtml(submission.created_at || "")}
    </p>`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: targets,
        subject: "New contact message from " + (submission.name || "the site"),
        html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px;border:1px solid #e5e5e5;border-radius:12px;">
          <div style="font-size:22px;font-weight:800;color:#0b3b2c;margin-bottom:4px;">TutorEnglishPro</div>
          <div style="font-size:13px;color:#6b7280;margin-bottom:20px;">${sanitizeTitle("New contact message")}</div>
          ${html}
        </div>`,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error("[contact] email error:", res.status, errText.slice(0, 400));
      return "error";
    }
    return "sent";
  } catch (e) {
    console.error("[contact] email error:", e.message);
    return "error";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }
  if (req.method !== "POST") {
    return json("error", { message: "Method not allowed" }, 405);
  }

  const ip = (req.headers.get("x-forwarded-for") || "anon").split(",")[0].trim();
  if (rateLimited(ip)) {
    return json("error", { message: "A little too fast - please wait a moment." }, 429);
  }

  let body = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const name = String(body.name || "").trim().slice(0, 120);
  const email = String(body.email || "").trim().toLowerCase();
  const message = String(body.message || "").trim().slice(0, 4000);

  if (!name) return json("error", { message: "Please add your name." }, 400);
  if (!isValidEmail(email)) return json("error", { message: "Please enter a valid email." }, 400);
  if (!message) return json("error", { message: "Please write a short message." }, 400);

  const row = {
    name,
    email,
    message,
    created_at: new Date().toISOString(),
  };

  let inserted = null;
  try {
    const { data, error } = await supabase.from("contacts").insert(row).select("*").maybeSingle();
    if (error) {
      console.error("[contact] insert error:", error.message);
      return json("error", { message: "Could not save your message. Please try again." }, 500);
    }
    inserted = data || null;
  } catch (e) {
    console.error("[contact] insert error:", e.message);
    return json("error", { message: "Could not save your message. Please try again." }, 500);
  }

  const emailStatus = await notifyStaff(inserted || row);

  return json("success", { id: inserted ? inserted.id : null, email: emailStatus }, 200);
});
