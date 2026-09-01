// ============================================================
// Ahmed English — Book Lesson (Supabase Edge Function)
// ------------------------------------------------------------
// Internal booking system linked to Cal.com.
//  - GET  /book-lesson?eventSlug=...&start=...&end=...&tz=...
//        -> proxies Cal.com available slots for that event type.
//  - POST /book-lesson  {eventSlug, start, timeZone}
//        -> creates a REAL Cal.com booking on Ahmed's calendar,
//           records it in the `bookings` table, and auto-consumes
//           one lesson from the student's active subscription.
//
// SECURITY: verify_jwt = true (see config.toml) means the caller
// MUST be a signed-in student. CAL_API_KEY is a server secret only
// (never in the browser). Writes go through the service_role key.
//
// Server secrets (Dashboard > Edge Functions > book-lesson):
//   CAL_API_KEY                 -> cal_live_... (owner API key)
//   SUPABASE_URL                -> https://gggziewyeqsnuixwhvoe.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   -> Dashboard > Settings > API (service_role)
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CAL_API_KEY = Deno.env.get("CAL_API_KEY") || "";
const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_SERVICE = Deno.env.get("SERVICE_ROLE_KEY") || "";
const CAL_BASE = "https://api.cal.com";
const CAL_VER = "2026-02-25";
const USERNAME = "ahmed-ghaith-fbjoax";

// Map our event slugs to Cal.com event slugs (and their durations).
const SLUG_MAP = {
  "30min-trial": { slug: "30min-trial", minutes: 30 },
  "30min":       { slug: "30min",       minutes: 30 },
  "60min":       { slug: "60min",       minutes: 60 },
};

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

async function requireStudent(req) {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  return profile || null;
}

// ---- GET: available slots for an event type ----
// Slots are limited to Ahmed's working window: 6:00 PM – 10:00 PM (GMT+8).
function inWorkingWindow(iso) {
  const d = new Date(iso);
  const h = (d.getUTCHours() + 8) % 24; // hour in GMT+8 (no DST)
  return h >= 18 && h < 22;
}

async function getSlots(url) {
  const params = new URLSearchParams(url.searchParams);
  const eventSlug = params.get("eventSlug") || "60min";
  const start = params.get("start") || new Date().toISOString().slice(0, 10);
  const end = params.get("end");
  const tz = params.get("tz") || "UTC";

  if (!SLUG_MAP[eventSlug]) return json("error", { message: "Unknown event type" }, 400);
  const calSlug = SLUG_MAP[eventSlug].slug;

  // Default window: next 14 days if no end given.
  const endDate = end || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

  const calUrl =
    `${CAL_BASE}/v2/slots?eventTypeSlug=${encodeURIComponent(calSlug)}` +
    `&username=${encodeURIComponent(USERNAME)}` +
    `&start=${encodeURIComponent(start)}&end=${encodeURIComponent(endDate)}` +
    `&timeZone=${encodeURIComponent(tz)}&format=range`;

  const res = await fetch(calUrl, {
    headers: {
      Authorization: `Bearer ${CAL_API_KEY}`,
      "cal-api-version": CAL_VER,
      Accept: "application/json",
    },
  });
  const body = await res.json();
  if (!res.ok) {
    return json("error", { message: body?.error?.message || body?.message || "Cal slots failed", detail: body }, res.status);
  }

  // Keep only slots inside the 18:00–22:00 GMT+8 window.
  const raw = body.data || {};
  const data = {};
  for (const [date, slots] of Object.entries(raw)) {
    const kept = (slots || []).filter(s => s && s.start && inWorkingWindow(s.start));
    if (kept.length) data[date] = kept;
  }

  return json("success", { data });
}

// ---- POST: create a real Cal.com booking + record + consume lesson ----
async function createBooking(user, body) {
  const eventSlug = body.eventSlug || "60min";
  const start = body.start;
  const timeZone = body.timeZone || "UTC";

  if (!SLUG_MAP[eventSlug]) return json("error", { message: "Unknown event type" }, 400);
  if (!start) return json("error", { message: "A start time is required" }, 400);
  const calSlug = SLUG_MAP[eventSlug].slug;

  const calRes = await fetch(`${CAL_BASE}/v2/bookings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CAL_API_KEY}`,
      "cal-api-version": CAL_VER,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      eventTypeSlug: calSlug,
      username: USERNAME,
      start,
      attendee: {
        name: user.full_name || user.email || "Student",
        email: user.email || "student@ahmedenglish.com",
        timeZone,
        language: "en",
      },
      metadata: { studentId: user.id },
    }),
  });
  const calData = await calRes.json();
  if (!calRes.ok) {
    return json("error", { message: calData?.error?.message || calData?.message || "Could not create booking on Cal.com", detail: calData }, calRes.status);
  }
  const b = calData.data || {};
  const minutes = SLUG_MAP[eventSlug].minutes;

  // Record the booking locally.
  const { data: bookingRow, error: insErr } = await supabase
    .from("bookings")
    .insert({
      student_id: user.id,
      event_slug: eventSlug,
      cal_uid: b.uid || null,
      title: b.title || eventSlug,
      start_at: b.start || start,
      end_at: b.end || null,
      duration_min: minutes,
      status: "booked",
      consumed_lesson: false,
    })
    .select("*")
    .maybeSingle();
  if (insErr) console.error("booking insert error:", insErr.message);

  // Auto-consume one lesson from the active subscription.
  const { data: remaining, error: consumeErr } = await supabase
    .rpc("consume_lesson", { p_student: user.id });
  if (consumeErr) console.error("consume_lesson error:", consumeErr.message);

  // Mark this booking as having consumed a lesson.
  if (bookingRow && Number.isInteger(remaining) && remaining >= 0) {
    await supabase.from("bookings").update({ consumed_lesson: true }).eq("id", bookingRow.id);
  }

  return json("success", {
    booking: bookingRow,
    cal: b,
    lessonsRemaining: Number.isInteger(remaining) ? remaining : null,
  }, 200);
}

// ---- POST: cancel a booking (credits a lesson back) ----
async function cancelBooking(user, body) {
  const bookingId = body.bookingId;
  if (!bookingId) return json("error", { message: "bookingId is required" }, 400);

  const { data: existing } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .maybeSingle();
  if (!existing) return json("error", { message: "Booking not found" }, 404);
  if (existing.student_id !== user.id) return json("error", { message: "Not your booking" }, 403);

  // Cancel on Cal.com if we have the uid.
  if (existing.cal_uid) {
    try {
      await fetch(`${CAL_BASE}/v2/bookings/${existing.cal_uid}/cancel`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CAL_API_KEY}`,
          "cal-api-version": CAL_VER,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cancellationReason: "Cancelled by student on site" }),
      });
    } catch (e) { console.error("cal cancel error:", e.message); }
  }

  // Credit the lesson back if a lesson was consumed.
  if (existing.consumed_lesson) {
    await supabase.rpc("credit_lesson", { p_student: user.id });
  }

  const { data: updated } = await supabase
    .from("bookings")
    .update({ status: "cancelled", consumed_lesson: false, cal_uid: null })
    .eq("id", bookingId)
    .select("*")
    .maybeSingle();

  return json("success", { booking: updated }, 200);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  const user = await requireStudent(req);
  if (!user) {
    return json("error", { message: "Please sign in to book a lesson." }, 401);
  }

  const url = new URL(req.url);

  if (req.method === "GET") {
    return await getSlots(url);
  }

  if (req.method === "POST") {
    let body = {};
    try { body = await req.json(); } catch { /* ignore */ }
    if (body.action === "cancel") return await cancelBooking(user, body);
    return await createBooking(user, body);
  }

  return json("error", { message: "Method not allowed" }, 405);
});
