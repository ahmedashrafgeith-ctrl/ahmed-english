// ============================================================
// Ahmed English — Cal.com Webhook (Supabase Edge Function)
// ------------------------------------------------------------
// Receives Cal.com booking webhooks (BOOKING_CREATED,
// BOOKING_CANCELLED, BOOKING_RESCHEDULED) and keeps Supabase in
// sync:
//   - BOOKING_CREATED     -> record the booking, consume a lesson
//                            from the student's active plan (matched
//                            by attendee email)
//   - BOOKING_CANCELLED   -> credit the lesson back, mark cancelled
//   - BOOKING_RESCHEDULED -> update the stored start/end times
//
// How to enable: Cal.com app -> Settings -> Webhooks -> Add webhook:
//   URL: https://gggziewyeqsnuixwhvoe.supabase.co/functions/v1/cal-webhook
//   Events: booking.created, booking.rescheduled, booking.cancelled
// (Currently only the Cal.com dashboard can register these — the
// Cal API key cannot create webhooks while Cal's mutation endpoints
// are returning 400.)
//
// SECURITY: verify_jwt = false (Cal.com cannot attach a signed JWT).
// The function only ever credits lesson timers and mirrors bookings;
// it never exposes data.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_SERVICE = Deno.env.get("SERVICE_ROLE_KEY") || "";
const supabase = createClient(SB_URL, SB_SERVICE);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(status, body, statusCode = 200) {
  return new Response(JSON.stringify({ status, ...body }), {
    status: statusCode,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function normEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function findStudentByEmail(email) {
  const em = normEmail(email);
  if (!em) return null;
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("email", em)
    .maybeSingle();
  return data || null;
}

async function upsertBooking(studentId, payload) {
  const uid = payload.uid || null;
  const start = payload.startTime || payload.start || null;
  const end = payload.endTime || payload.end || null;
  const slug = payload.eventType?.slug || payload.type || null;
  const title = payload.title || slug || "Lesson";
  const attendees = payload.attendees || [];
  const email = attendees[0]?.email || payload.responses?.email || payload.email || null;

  const { data: existing } = await supabase
    .from("bookings")
    .select("*")
    .eq("cal_uid", uid)
    .maybeSingle();

  if (existing) {
    const { data: updated } = await supabase
      .from("bookings")
      .update({ start_at: start || existing.start_at, end_at: end || existing.end_at, title })
      .eq("id", existing.id)
      .select("*")
      .maybeSingle();
    return updated || existing;
  }

  const { data: inserted } = await supabase
    .from("bookings")
    .insert({
      student_id: studentId,
      event_slug: slug,
      cal_uid: uid,
      title,
      start_at: start,
      end_at: end,
      duration_min: payload.eventType?.length || null,
      status: "booked",
      consumed_lesson: false,
    })
    .select("*")
    .maybeSingle();
  return inserted || null;
}

async function consumeLesson(studentId) {
  const { data: remaining, error } = await supabase
    .rpc("consume_lesson", { p_student: studentId });
  if (error) {
    console.error("consume_lesson error:", error.message);
    return null;
  }
  return Number.isInteger(remaining) ? remaining : null;
}

async function creditLesson(studentId) {
  const { error } = await supabase.rpc("credit_lesson", { p_student: studentId });
  if (error) console.error("credit_lesson error:", error.message);
  return !error;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }
  if (req.method !== "POST") {
    return json("error", { message: "Method not allowed" }, 405);
  }

  let body = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const trigger = body.triggerEvent || body.trigger || "";
  const payload = body.payload || body.data || {};
  const uid = payload.uid || null;
  const attendees = payload.attendees || [];
  const email = attendees[0]?.email || payload.responses?.email || payload.email || "";
  const student = await findStudentByEmail(email);

  // Guest bookings (no matching profile) are still mirrored for records
  // but no lesson can be consumed (guests have no plan).
  if (!student) {
    if (trigger === "BOOKING_CREATED") {
      await upsertBooking(null, payload);
    }
    return json("success", { handled: true, guest: true }, 200);
  }

  if (trigger === "BOOKING_CREATED") {
    const booking = await upsertBooking(student.id, payload);
    const remaining = await consumeLesson(student.id);
    if (booking && Number.isInteger(remaining) && remaining >= 0) {
      await supabase.from("bookings").update({ consumed_lesson: true }).eq("id", booking.id);
    }
    return json("success", { handled: true, consumed: Number.isInteger(remaining), lessonsLeft: remaining }, 200);
  }

  if (trigger === "BOOKING_CANCELLED") {
    if (uid) {
      const { data: existing } = await supabase.from("bookings").select("*").eq("cal_uid", uid).maybeSingle();
      if (existing && existing.student_id === student.id && existing.consumed_lesson) {
        await creditLesson(student.id);
      }
      await supabase.from("bookings").update({ status: "cancelled", consumed_lesson: false }).eq("cal_uid", uid);
    }
    return json("success", { handled: true, cancelled: true }, 200);
  }

  if (trigger === "BOOKING_RESCHEDULED") {
    if (uid) {
      await supabase.from("bookings").update({
        start_at: payload.startTime || null,
        end_at: payload.endTime || null,
      }).eq("cal_uid", uid);
    }
    return json("success", { handled: true, rescheduled: true }, 200);
  }

  // Unknown trigger (e.g. BOOKING_CONFIRMED, MEETING_ENDED) — ignore.
  return json("success", { handled: true, skipped: true }, 200);
});