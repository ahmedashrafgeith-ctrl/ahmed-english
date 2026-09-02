// ============================================================
// TutorEnglishPro — Stripe Webhook (Supabase Edge Function)
// ------------------------------------------------------------
// Purpose: keeps the public `subscriptions` table in sync with
// real Stripe payments so the admin "Revenue" and teacher
// "Active Subscriptions" are populated automatically.
//
// Endpoint: POST
//   https://<project-ref>.supabase.co/functions/v1/stripe-webhook
//
// Server secrets (set in Supabase Dashboard > Edge Functions > stripe-webhook):
//   STRIPE_WEBHOOK_SECRET   -> from Stripe Dashboard > Webhooks (whsec_...)
//   STRIPE_SECRET_KEY       -> Stripe secret key (sk_live_... / sk_test_...)
//   SUPABASE_URL            -> https://gggziewyeqsnuixwhvoe.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY -> Dashboard > Settings > API (service_role key)
// ============================================================

import Stripe from "https://esm.sh/stripe@14.20.0?target=deno&no-treeshake=true";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY") || "";
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseKey = Deno.env.get("SERVICE_ROLE_KEY") || "";

const stripe = new Stripe(stripeSecret, { apiVersion: "2023-10-16" });
const supabase = createClient(supabaseUrl, supabaseKey);

// Maps a Stripe price/amount (in cents) to a package + lesson count.
// Programming-Price-Lookups from your Stripe payment link line items
// are matched here. Add/remove entries to match your live amounts.
const PLAN_MAP: Record<number, { name: string; lessons: number }> = {
  // Starter $40.00
  4000: { name: "Starter", lessons: 4 },
  // Progress $70.00
  7000: { name: "Progress", lessons: 8 },
  // Intensive $100.00
  10000: { name: "Intensive", lessons: 12 },
};

function planFromAmount(amount: number) {
  return PLAN_MAP[amount] || { name: "Custom Package", lessons: 1 };
}

function normalizeEmail(email: string | null | undefined): string {
  return (email || "").trim().toLowerCase();
}

async function findOrCreateStudent(email: string) {
  const em = normalizeEmail(email);
  if (!em) return null;

  const { data: existing } = await supabase
    .from("profiles")
    .select("*")
    .eq("email", em)
    .maybeSingle();

  if (existing) return existing;

  // Student has no profile yet — create one as 'student' (role must
  // never become admin/tutor from a payment).
  const { data: created, error: err } = await supabase
    .from("profiles")
    .insert({
      email: em,
      full_name: em.split("@")[0],
      role: "student",
      english_level: "Intermediate",
      learning_goal: "Improve spoken English confidence and fluency",
    })
    .select("*")
    .maybeSingle();

  if (err) {
    console.error("findOrCreateStudent insert error:", err.message);
    return null;
  }
  return created;
}

async function upsertSubscription(studentId: string, planName: string, lessons: number) {
  // No unique constraint on subscriptions.student_id, so do a manual
  // find-existing-then-insert-or-update (one active subscription per student).
  const { data: existing } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("student_id", studentId)
    .eq("status", "active")
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("subscriptions")
      .update({
        package_name: planName,
        lessons_total: lessons,
        status: "active",
        created_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) console.error("upsertSubscription update error:", error.message);
    return !error;
  }

  const { error } = await supabase.from("subscriptions").insert({
    student_id: studentId,
    package_name: planName,
    lessons_total: lessons,
    lessons_used: 0,
    status: "active",
    created_at: new Date().toISOString(),
  });
  if (error) console.error("upsertSubscription insert error:", error.message);
  return !error;
}

async function deactivateSubscription(studentId: string) {
  const { error } = await supabase
    .from("subscriptions")
    .update({ status: "canceled" })
    .eq("student_id", studentId);
  if (error) console.error("deactivateSubscription error:", error.message);
}

async function handleCheckoutSession(session: any) {
  // Only react to successful payments.
  if (session.payment_status !== "paid") return;

  const email = session.customer_details?.email || session.customer_email;

  // Resolve the paid amount (cents) from the checkout line items.
  let amount = 0;
  if (session.amount_total) {
    amount = session.amount_total;
  } else if (session.line_items && session.line_items.data) {
    amount = session.line_items.data.reduce((s: number, li: any) => s + (li.amount_total || 0), 0);
  }

  const plan = planFromAmount(amount);

  const student = await findOrCreateStudent(email);
  if (!student) {
    console.error("Could not resolve student for email:", email);
    return;
  }
  await upsertSubscription(student.id, plan.name, plan.lessons);
}

async function handleSubscription(sub: any) {
  // Cancelled / unpaid subscriptions become non-active.
  if (sub.status === "canceled" || sub.status === "unpaid" || sub.status === "past_due") {
    const meta = sub.metadata || {};
    const email = meta.student_email;
    if (email) {
      const student = await findOrCreateStudent(email);
      if (student) await deactivateSubscription(student.id);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!sig || !webhookSecret) {
    return new Response("Missing signature or secret", { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err: any) {
    console.error("Webhook signature verification failed:", err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSession(event.data.object);
        break;
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await handleSubscription(event.data.object);
        break;
      default:
        // Other events are intentionally ignored.
        break;
    }
  } catch (err: any) {
    console.error("Handler error:", err.message);
    return new Response("Handler error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

