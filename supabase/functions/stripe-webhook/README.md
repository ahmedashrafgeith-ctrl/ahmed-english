# Stripe Webhook — Deploy Guide

This Edge Function keeps the public `subscriptions` table in sync with real Stripe
payments, so the **admin Console (Revenue KPI)** and **teacher dashboard (Active
Subscriptions)** show real paying students automatically.

## 1. Deploy the function

You need the Supabase CLI installed (Node.js). From the project root:

```bash
npx supabase login
npx supabase functions deploy stripe-webhook --project-ref gggziewyeqsnuixwhvoe
```

(Folder: `supabase/functions/stripe-webhook/`)

## 2. Set the secrets

In Supabase Dashboard → **Edge Functions → stripe-webhook → Secrets**, add:

| Key | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | Your Stripe secret key (sk_live_... / sk_test_...) |
| `STRIPE_WEBHOOK_SECRET` | The `whsec_...` from step 3 |
| `SUPABASE_URL` | `https://gggziewyeqsnuixwhvoe.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Dashboard → Settings → API → `service_role` key |

> The service_role key is a server secret only — never put it in browser code.

## 3. Create the Stripe webhook endpoint

1. Stripe Dashboard → **Developers → Webhooks → Add endpoint**.
2. Endpoint URL: `https://gggziewyeqsnuixwhvoe.supabase.co/functions/v1/stripe-webhook`
3. Events to send:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Click **Add endpoint** → copy the **Signing secret** (`whsec_...`) → paste it as
   `STRIPE_WEBHOOK_SECRET` in step 2.

## 4. Plan pricing (edit if needed)

The function maps the paid amount to a package. Open `index.ts` → `PLAN_MAP`:

```
14900  -> Starter   (4 lessons)   // $149.00
57900  -> Progress  (8 lessons)   // $579.00
129900 -> Intensive (12 lessons)  // $1299.00
```

Amounts are in **cents**. Add or change entries to match your real prices.

## How it works

1. A student pays via a Stripe Payment Link.
2. Stripe calls the webhook with `checkout.session.completed`.
3. The function reads the customer email + paid amount.
4. It finds-or-creates the student in `profiles` and adds/updates the
   `subscriptions` row as `active`.
5. Admin Console revenue + teacher "Active Subscriptions" now show that student.

> Notes: a student who pays but never signs up gets a profile row so they appear
> in the dashboard. When they later sign up, the auto-profile trigger keeps their
> existing profile (no duplicate). The service_role key bypasses RLS for the webhook
> writes only.
