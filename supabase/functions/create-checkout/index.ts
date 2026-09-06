// ============================================================
// TutorEnglishPro — Create Stripe Checkout Session (Supabase Edge Function)
// ------------------------------------------------------------
// Purpose: creates a hosted Stripe Checkout Session that expires
// in ~30 minutes (Stripe enforces 30 min minimum / 24 h max for
// expires_at, versus the 24 h forced on Payment Links).
//
// Endpoint: POST
//   https://<project-ref>.supabase.co/functions/v1/create-checkout
//   Content-Type: application/json
//   Body: { "plan": "starter" | "progress" | "intensive" }
//   Optional: { "email": "student@example.com" }
//
// Response 200: { "url": "https://checkout.stripe.com/..." }
//
// Server secrets (set in Supabase Dashboard > Edge Functions > create-checkout):
//   STRIPE_SECRET_KEY  -> Stripe secret key (sk_live_... / sk_test_...)
// ============================================================

import Stripe from "https://esm.sh/stripe@14.20.0?target=deno&no-treeshake=true";

const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY") || "";

const stripe = new Stripe(stripeSecret, { apiVersion: "2023-10-16" });

// Package catalog shared with the webhook (plan -> price + lesson count).
const PLANS: Record<string, { name: string; lessons: number; amountCents: number }> = {
  starter: { name: "Starter", lessons: 4, amountCents: 14900 },
  progress: { name: "Progress", lessons: 8, amountCents: 57900 },
  intensive: { name: "Intensive", lessons: 12, amountCents: 129900 },
};

// Stripe requires expires_at >= now + 30 minutes and <= now + 24 hours.
function sessionExpiry(): number {
  return Math.floor(Date.now() / 1000) + 31 * 60;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed. Use POST." }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const planKey = String(body.plan || "").trim().toLowerCase();
  const plan = PLANS[planKey];
  if (!plan) {
    return json({ error: `Unknown plan "${planKey}". Use one of: ${Object.keys(PLANS).join(", ")}.` }, 400);
  }

  const email = String(body.email || "").trim().toLowerCase();

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      expires_at: sessionExpiry(),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: plan.amountCents,
            product_data: {
              name: `${plan.name} — ${plan.lessons} 1-on-1 English Lessons`,
              description: `TutorEnglishPro ${plan.name} package: ${plan.lessons} x 60-min private lessons per month.`,
              metadata: { plan: planKey, lessons: String(plan.lessons) },
            },
          },
        },
      ],
      payment_intent_data: {
        metadata: { plan: planKey, lessons: String(plan.lessons) },
      },
      metadata: {
        plan: planKey,
        lessons: String(plan.lessons),
        ...(email ? { student_email: email } : {}),
      },
      ...(email ? { customer_email: email } : {}),
      success_url: "https://www.proenglishtutor.online/success.html?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://www.proenglishtutor.online/booking.html",
    });

    return json({ url: session.url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("create-checkout error:", message);
    return json({ error: "Could not create checkout session. " + message }, 500);
  }
});