// ============================================================
// Ahmed English — Live Chat (Supabase Edge Function)
// ------------------------------------------------------------
// Powering the student chat widget and the Admin Dashboard inbox.
//
//  - POST { action:"send", chatId?, body }
//      Creates/continues a conversation. The sender's role decides
//      'student' vs 'admin'. Notifications are emailed out:
//        * student message -> admin(s) email (open the dashboard)
//        * admin reply      -> student email (open the chat)
//
//  - GET  { action:"chats" }
//      Returns the current user's conversations (students: their
//      own; staff/admin: everyone) with last message + unread counts.
//
//  - POST { action:"read", chatId }
//      Marks the caller's side of the conversation as read.
//
// SECURITY: verify_jwt = true. Sending requires a signed-in user
// with a profile. Reads/writes go through the service_role key and
// are scoped to the authenticated user (never cross-account unless
// the caller is staff/admin).
//
// EMAIL: uses Resend when RESEND_API_KEY is set, otherwise a generic
// SMTP server (SMTP_HOST/SMTP_USER/SMTP_PASS — e.g. a free Gmail App
// Password) when configured. Without any provider the function still
// works (messages are stored) and only the email is skipped.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_SERVICE = Deno.env.get("SERVICE_ROLE_KEY") || "";
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") || "";
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") || "Ahmed English <onboarding@resend.dev>";
const SITE_URL = Deno.env.get("SITE_URL") || "https://www.proenglishtutor.online";

// SMTP provider (free option — e.g. Gmail App Password, no domain needed).
const SMTP_HOST = Deno.env.get("SMTP_HOST") || "";
const SMTP_PORT = parseInt(Deno.env.get("SMTP_PORT") || "465", 10);
const SMTP_USER = Deno.env.get("SMTP_USER") || "";
const SMTP_PASS = Deno.env.get("SMTP_PASS") || "";
const SMTP_FROM = Deno.env.get("SMTP_FROM") || SMTP_USER;

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

async function getUser(req) {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  let { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) {
    const meta = user.user_metadata || {};
    const { data: created } = await supabase
      .from("profiles")
      .insert({
        id: user.id,
        email: String(user.email || "").toLowerCase(),
        full_name: meta.full_name || meta.name || null,
        role: "student",
      })
      .select("*")
      .maybeSingle();
    profile = created || null;
  }
  return { user, profile };
}

function isStaff(profile) {
  return profile && (profile.role === "admin" || profile.role === "staff");
}

function preview(text) {
  const t = String(text || "").trim().replace(/\s+/g, " ");
  return t.length > 60 ? t.slice(0, 60) + "…" : t;
}

function escHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// -------- email notifications (Resend or SMTP when configured) --------
async function sendEmail(to, subject, html) {
  const haveResend = !!RESEND_KEY;
  const haveSmtp = !!SMTP_HOST && !!SMTP_USER && !!SMTP_PASS;
  if (!haveResend && !haveSmtp) {
    console.log("[chat] email skipped (no RESEND_API_KEY / SMTP_* configured)");
    return "skipped";
  }

  if (haveResend) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: EMAIL_FROM,
          to,
          subject,
          html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px;border:1px solid #e5e5e5;border-radius:12px;">
            <div style="font-size:22px;font-weight:800;color:#0b3b2c;margin-bottom:4px;">Ahmed English</div>
            <div style="font-size:13px;color:#6b7280;margin-bottom:20px;">${sanitizeTitle(subject)}</div>
            ${html}
          </div>`,
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        console.error("[chat] email error:", res.status, errText.slice(0, 400));
        return "error";
      }
      return "sent";
    } catch (e) {
      console.error("[chat] email error:", e.message);
      return "error";
    }
  }

  try {
    const { SmtpClient } = await import("https://deno.land/x/smtp@v0.7.0/mod.ts");
    const client = new SmtpClient();
    await client.connect({
      hostname: SMTP_HOST,
      port: SMTP_PORT,
      username: SMTP_USER,
      password: SMTP_PASS,
      tls: SMTP_PORT === 465,
    });
    await client.send({
      from: SMTP_FROM,
      to,
      subject,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px;border:1px solid #e5e5e5;border-radius:12px;">
        <div style="font-size:22px;font-weight:800;color:#0b3b2c;margin-bottom:4px;">Ahmed English</div>
        <div style="font-size:13px;color:#6b7280;margin-bottom:20px;">${sanitizeTitle(subject)}</div>
        ${html}
      </div>`,
    });
    await client.close();
    return "sent";
  } catch (e) {
    console.error("[chat] smtp error:", e.message);
    return "error";
  }
}

function sanitizeTitle(t) {
  return String(t || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function notifyAdminsOfStudentMessage(student, body, chatId) {
  const { data: admins } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .in("role", ["admin", "staff"]);
  const targets = (admins || [])
    .map(a => a.email)
    .filter(e => e && /@/.test(e));
  if (!targets.length) return "no-admin";

  const name = student.full_name || student.email || "A student";
  const html = `
    <p style="margin:0 0 12px;color:#111;font-size:15px;">
      <strong>${escHtml(name)}</strong> sent you a message:
    </p>
    <div style="background:#f3fbf6;border:1px solid #d8efdf;border-radius:10px;padding:14px;color:#111;font-size:15px;white-space:pre-wrap;">${escHtml(body)}</div>
    <p style="margin:16px 0 20px;color:#6b7280;font-size:13px;">
      Student: ${escHtml(student.email || "")}<br>
      ${escHtml(name)}
    </p>
    <a href="${SITE_URL}/admin.html#chat" style="display:inline-block;background:#0b3b2c;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 18px;border-radius:8px;">Open Chat in Admin Dashboard</a>`;
  return sendEmail(targets, "New message from " + name, html);
}

async function notifyStudentOfAdminReply(student, body, chatId) {
  if (!student.email || !/@/.test(student.email)) return "no-email";
  const html = `
    <p style="margin:0 0 12px;color:#111;font-size:15px;">Ahmed replied to your chat:</p>
    <div style="background:#eef3ff;border:1px solid #d6e0ff;border-radius:10px;padding:14px;color:#111;font-size:15px;white-space:pre-wrap;">${escHtml(body)}</div>
    <p style="margin:16px 0 20px;color:#6b7280;font-size:13px;">Keep the conversation going — just open the chat and continue typing.</p>
    <a href="${SITE_URL}/booking.html#chat" style="display:inline-block;background:#0b3b2c;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 18px;border-radius:8px;">Open Chat</a>`;
  return sendEmail(student.email, "Ahmed replied to your chat", html);
}

// -------- actions --------

async function sendMessage(ctx, body) {
  const { user, profile } = ctx;
  const text = String(body.body || "").trim();
  if (!text) return json("error", { message: "Message is required" }, 400);

  const sender = isStaff(profile) ? "admin" : "student";
  const chatId = body.chatId || null;

  let chat = null;
  if (chatId) {
    const { data: existing } = await supabase
      .from("chats").select("*").eq("id", chatId).maybeSingle();
    if (!existing) return json("error", { message: "Chat not found" }, 404);
    if (existing.student_id !== user.id && !isStaff(profile)) {
      return json("error", { message: "Not your chat" }, 403);
    }
    chat = existing;
  } else {
    if (sender !== "student") {
      return json("error", { message: "Select a conversation to reply to" }, 400);
    }
    const { data: created } = await supabase
      .from("chats").insert({
        student_id: user.id,
        subject: preview(text),
        status: "open",
        unread_admin: 0,
        last_message_at: new Date().toISOString(),
      }).select("*").maybeSingle();
    chat = created;
  }

  const { data: message } = await supabase
    .from("chat_messages").insert({
      chat_id: chat.id,
      sender,
      body: text,
    }).select("*").maybeSingle();

  // bump the opposite side's unread counter
  const unreadCol = sender === "student" ? "unread_admin" : "unread_student";
  await supabase.from("chats")
    .update({ [unreadCol]: (chat[unreadCol] || 0) + 1, updated_at: new Date().toISOString(), last_message_at: new Date().toISOString() })
    .eq("id", chat.id);

  let email = "skipped";
  if (sender === "student") {
    email = await notifyAdminsOfStudentMessage(profile, text, chat.id);
  } else {
    const { data: studentProfile } = await supabase
      .from("profiles").select("*").eq("id", chat.student_id).maybeSingle();
    if (studentProfile) email = await notifyStudentOfAdminReply(studentProfile, text, chat.id);
  }

  return json("success", { chatId: chat.id, message, email }, 200);
}

async function listChats(ctx) {
  const { user, profile } = ctx;
  let query = supabase.from("chats").select("*, student:profiles!chats_student_id_fkey(id, email, full_name)");
  if (!isStaff(profile)) {
    query = query.eq("student_id", user.id);
  }
  const { data: chats } = await query.order("last_message_at", { ascending: false }).limit(100);

  const out = [];
  for (const c of chats || []) {
    const { data: last } = await supabase
      .from("chat_messages").select("*").eq("chat_id", c.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    out.push({
      id: c.id,
      student_id: c.student_id,
      student_name: c.student?.full_name || c.student?.email || "Student",
      student_email: c.student?.email || "",
      subject: c.subject,
      status: c.status,
      unread_student: c.unread_student,
      unread_admin: c.unread_admin,
      last_message_at: c.last_message_at,
      last_message: last ? { sender: last.sender, body: last.body, created_at: last.created_at } : null,
    });
  }
  return json("success", { chats: out }, 200);
}

async function markRead(ctx, body) {
  const { user, profile } = ctx;
  const chatId = body.chatId;
  if (!chatId) return json("error", { message: "chatId is required" }, 400);

  const { data: chat } = await supabase.from("chats").select("*").eq("id", chatId).maybeSingle();
  if (!chat) return json("error", { message: "Chat not found" }, 404);
  if (chat.student_id !== user.id && !isStaff(profile)) {
    return json("error", { message: "Not your chat" }, 403);
  }

  const mySender = isStaff(profile) ? "admin" : "student";
  await supabase
    .from("chat_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("chat_id", chatId)
    .neq("sender", mySender)
    .is("read_at", null);

  const clearCol = mySender === "student" ? "unread_student" : "unread_admin";
  await supabase.from("chats").update({ [clearCol]: 0 }).eq("id", chatId);

  return json("success", { chatId }, 200);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return json("error", { message: "Method not allowed" }, 405);
  }

  const ctx = await getUser(req);
  if (!ctx) {
    return json("error", { message: "Please sign in to use chat." }, 401);
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "chats";

  if (req.method === "GET") {
    if (action === "chats" || action === "list") return await listChats(ctx);
    return json("error", { message: "Unknown action" }, 400);
  }

  let body = {};
  try { body = await req.json(); } catch { /* ignore */ }
  if (body.action === "read" || action === "read") return await markRead(ctx, body);
  if (body.action === "send" || action === "send") return await sendMessage(ctx, body);

  const parsed = { ...body };
  parsed.action = "send";
  return await sendMessage(ctx, parsed);
});