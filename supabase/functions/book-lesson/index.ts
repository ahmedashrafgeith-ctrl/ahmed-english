// ============================================================
// TutorEnglishPro - Book Lesson (Supabase Edge Function)
// ------------------------------------------------------------
// Internal booking system linked to Cal.com.
//
//  - GET  /book-lesson?eventSlug=...&start=...&end=...&tz=...
//        -> computes available slots from Ahmed's Cal.com schedule
//           (18:00-22:00 GMT+8 daily), minus existing bookings.
//           Availability is computed from the schedule window and
//           existing bookings fetched via /v2/bookings.
//
//  - POST /book-lesson  {eventSlug, start, timeZone}
//        -> ONE-TAP in-app booking. Creates the booking directly on
//           Cal.com via POST /v2/bookings (with the server-side
//           CAL_API_KEY). Cal.com records the calendar event AND
//           automatically emails the student + host (confirmation).
//           On success we store the Cal.com uid + status "booked"
//           in Supabase and consume one lesson from the student's
//           active plan. No deep link / no second confirmation step.
//
//  - POST /book-lesson  {action:"cancel", bookingId}
//        -> cancels on Cal.com (POST /v2/bookings/{uid}/cancel),
//           credits the lesson back, marks the booking cancelled.
//
// SECURITY: verify_jwt = true (see config.toml) means the caller
// MUST be a signed-in student. CAL_API_KEY is a server secret set
// via the Supabase Management API (never in the browser or repo).
// Writes go through the service_role key.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CAL_API_KEY = Deno.env.get("CAL_API_KEY") || "";
const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_SERVICE = Deno.env.get("SERVICE_ROLE_KEY") || "";
const CAL_BASE = "https://api.cal.com";
const CAL_VER = "2026-02-25";

// Map our event slugs to Cal.com eventType IDs, slugs, durations.
// eventTypeId values were read live from GET /v2/event-types.
const SLUG_MAP = {
  "30min-trial": { slug: "30min-trial", eventTypeId: 6757821, minutes: 30 },
  "30min":       { slug: "30min",       eventTypeId: 6757819, minutes: 30 },
  "60min":       { slug: "60min",       eventTypeId: 6757820, minutes: 60 },
};

// Ahmed's working window: 18:00 - 22:00 (GMT+8). Verified against the
// Cal.com schedule (Asia/Kuala_Lumpur, 18:00-22:00, all days).
const WIN_START_MIN = 18 * 60;
const WIN_END_MIN = 22 * 60;
// Cal.com enforces a 120-minute (2 hour) minimum booking notice on these
// event types. We hide any slot closer than this so students never see a
// time Cal.com will reject.
const MIN_NOTICE_MS = 120 * 60 * 1000;

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
  let { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) {
    // Self-heal accounts registered before the on_auth_user_created
    // trigger existed (or created via the admin API).
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
  return profile || null;
}

// ---- GET: available slots for an event type ----
function inWorkingWindow(iso) {
  const d = new Date(iso);
  const h = (d.getUTCHours() + 8) % 24; // hour in GMT+8 (no DST)
  return h >= 18 && h < 22;
}

// Fetch Ahmed's existing bookings (the reliable, working read API).
async function fetchBusy(startIso, endIso) {
  try {
    const params = new URLSearchParams({ limit: "100" });
    // start/end are the UTC slice of the whole window we display.
    params.set("status", "upcoming");
    const res = await fetch(`${CAL_BASE}/v2/bookings?${params}`, {
      headers: {
        Authorization: `Bearer ${CAL_API_KEY}`,
        "cal-api-version": CAL_VER,
        Accept: "application/json",
      },
    });
    if (!res.ok) return [];
    const body = await res.json();
    const bookings = (body?.data?.bookings) || [];
    const busy = [];
    for (const b of bookings) {
      const s = b.start ? new Date(b.start) : null;
      const e = b.end ? new Date(b.end) : null;
      if (s && e && !isNaN(s.getTime()) && !isNaN(e.getTime())) {
        busy.push({ start: s, end: e });
      }
    }
    return busy;
  } catch (e) {
    console.error("fetch busy error:", e.message);
    return [];
  }
}

// Compute free slots inside 18:00-22:00 (GMT+8) for each date.
function computeSlots(eventSlug, start, end, busy) {
  const minutes = SLUG_MAP[eventSlug].minutes;
  const startDate = new Date(start + "T00:00:00Z");
  const endDate = new Date(end + "T23:59:59.000Z");
  const data = {};

  for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
    const dateKey = d.toISOString().slice(0, 10);
    // 18:00 GMT+8 == 10:00 UTC on the same calendar date.
    const dayUTC = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const winStart = new Date(dayUTC + (WIN_START_MIN - 8 * 60) * 60000);
    const winEnd = new Date(dayUTC + (WIN_END_MIN - 8 * 60) * 60000);

    const step = minutes === 60 ? 60 : 30;
    const slots = [];
    const nowMs = Date.now();
    for (let s = new Date(winStart); s.getTime() + minutes * 60000 <= winEnd.getTime(); s = new Date(s.getTime() + step * 60000)) {
      const sMs = s.getTime();
      const eMs = sMs + minutes * 60000;
      // Hide anything already past, and anything within Cal.com's minimum
      // booking notice (so a slot Cal.com would reject is never shown).
      if (sMs <= nowMs) continue;
      if (sMs - nowMs < MIN_NOTICE_MS) continue;
      const overlaps = busy.some(b => sMs < b.end.getTime() && eMs > b.start.getTime());
      if (overlaps) continue;
      const iso = s.toISOString();
      if (!inWorkingWindow(iso)) continue; // safety
      slots.push({ start: iso, end: new Date(eMs).toISOString() });
    }
    if (slots.length) data[dateKey] = slots;
  }
  return data;
}

async function getSlots(url) {
  const params = new URLSearchParams(url.searchParams);
  const eventSlug = params.get("eventSlug") || "60min";
  const start = params.get("start") || new Date().toISOString().slice(0, 10);
  const end = params.get("end");
  const tz = params.get("tz") || "UTC";

  if (!SLUG_MAP[eventSlug]) return json("error", { message: "Unknown event type" }, 400);

  const endDate = end || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const busy = await fetchBusy(start + "T00:00:00Z", endDate + "T23:59:59.000Z");
  const data = computeSlots(eventSlug, start, endDate, busy);

  return json("success", { data, timeZone: tz });
}

// ---- POST: create the booking on Cal.com (1-tap, in-app) ----
async function createBooking(user, body) {
  const eventSlug = body.eventSlug || "60min";
  const start = body.start;
  const timeZone = body.timeZone || "UTC";

  if (!SLUG_MAP[eventSlug]) return json("error", { message: "Unknown event type" }, 400);
  if (!start) return json("error", { message: "A start time is required" }, 400);

  const cfg = SLUG_MAP[eventSlug];
  const minutes = cfg.minutes;
  const startMs = Math.floor(new Date(start).getTime());
  const endIso = new Date(startMs + minutes * 60000).toISOString();

  // Create the booking on Cal.com directly with the server-side key.
  // Cal.com records the event, opens the calendar slot, and emails the
  // student + host automatically (no second step for the student).
  let cal = null;
  try {
    const res = await fetch(`${CAL_BASE}/v2/bookings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CAL_API_KEY}`,
        "cal-api-version": CAL_VER,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        eventTypeId: cfg.eventTypeId,
        start: new Date(startMs).toISOString(),
        attendee: {
          name: user.full_name || user.email || "Student",
          email: user.email || "",
          timeZone,
          language: "en",
        },
      }),
    });
    const out = await res.json();
    if (!res.ok) {
      let reason = "That time couldn't be booked. Please pick another slot.";
      let code = 502;
      if (res.status === 401) { reason = "We couldn't confirm your booking just now. Please try again in a moment."; code = 502; }
      if (res.status === 409) { reason = "Sorry, that slot was just taken. Please pick another time."; code = 409; }
      if (res.status === 422) { reason = "Sorry, that time is no longer available. Please pick another slot."; code = 422; }
      console.error("[book-lesson] cal create error", res.status, JSON.stringify(out));
      return json("error", { message: reason }, code);
    }
    cal = out?.data || null;
  } catch (e) {
    console.error("[book-lesson] cal create exception:", e.message);
    return json("error", { message: "Could not reach Cal.com to confirm your booking. Please try again." }, 502);
  }

  const uid = cal?.uid || null;
  const calStart = cal?.start || new Date(startMs).toISOString();
  const calEnd = cal?.end || endIso;
  const title = cal?.title || cfg.slug;

  // Persist the confirmed booking in Supabase with the Cal.com uid.
  let booking = null;
  try {
    const { data: ins } = await supabase
      .from("bookings")
      .insert({
        student_id: user.id,
        event_slug: eventSlug,
        cal_uid: uid,
        title,
        start_at: calStart,
        end_at: calEnd,
        duration_min: minutes,
        status: "booked",
        consumed_lesson: false,
      })
      .select("*")
      .maybeSingle();
    booking = ins || null;
  } catch (e) {
    console.error("[book-lesson] insert booking error:", e.message);
  }

  // Consume one lesson from the student's active plan.
  let remaining = null;
  try {
    const { data: rem } = await supabase.rpc("consume_lesson", { p_student: user.id });
    if (Number.isInteger(rem) && rem >= 0) {
      remaining = rem;
      if (booking) {
        await supabase.from("bookings").update({ consumed_lesson: true }).eq("id", booking.id);
      }
    }
  } catch (e) {
    console.error("[book-lesson] consume_lesson error:", e.message);
  }

  return json("success", {
    booking,
    calBooking: cal,
    lessonsLeft: remaining,
    message: "Your lesson is booked. Cal.com has emailed you the confirmation and calendar invite.",
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

  // If we never got a Cal.com uid (legacy/imported pending), just remove it.
  if (!existing.cal_uid) {
    const { data: removed } = await supabase
      .from("bookings")
      .delete()
      .eq("id", bookingId)
      .select("*")
      .maybeSingle();
    return json("success", { booking: removed || null, message: "Booking removed." }, 200);
  }

  // Cancel the booking on Cal.com using its uid (server-side key).
  try {
    const res = await fetch(`${CAL_BASE}/v2/bookings/${existing.cal_uid}/cancel`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CAL_API_KEY}`,
        "cal-api-version": CAL_VER,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ cancellationReason: "Cancelled by student on site" }),
    });
    if (!res.ok) {
      const out = await res.json().catch(() => ({}));
      console.error("[book-lesson] cal cancel error", res.status, JSON.stringify(out));
      return json("error", {
        message: "Could not cancel on Cal.com. Please use the 'Manage booking' link in your confirmation email (your lesson will be credited after it is cancelled).",
      }, 502);
    }
  } catch (e) {
    console.error("[book-lesson] cal cancel exception:", e.message);
    return json("error", {
      message: "Could not reach Cal.com to cancel. Please use the link in your confirmation email.",
    }, 502);
  }

  // Credit the lesson back if a lesson was consumed.
  if (existing.consumed_lesson) {
    await supabase.rpc("credit_lesson", { p_student: user.id });
  }

  const { data: updated } = await supabase
    .from("bookings")
    .update({ status: "cancelled", consumed_lesson: false })
    .eq("id", bookingId)
    .select("*")
    .maybeSingle();

  return json("success", { booking: updated, message: "Lesson cancelled and credited back." }, 200);
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
