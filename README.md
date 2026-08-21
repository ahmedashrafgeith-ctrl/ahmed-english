# Ahmed English — Standalone Tutor Platform v3

Professional standalone tutor website/app starter.

Includes:
- Responsive colorful public landing funnel
- About, Lessons, Packages, Booking, Login, Privacy and Terms pages
- Supabase authentication and database schema
- Tutor dashboard
- Student portal
- Stripe subscription webhook Edge Function
- Cal.com booking integration point
- Google Sites embed snippets
- No fake logos, testimonials, awards, student counts or credentials

## Setup
1. Create a Supabase project.
2. Run `supabase/schema.sql`.
3. Enable Email/Password authentication.
4. Create your tutor account and set its `profiles.role` to `tutor`.
5. Copy `js/config.example.js` to `js/config.js` and add your public Supabase configuration.
6. Create real Stripe products/prices and Payment Links.
7. Add the real Stripe Payment Links to `js/config.js`.
8. Create Cal.com events and connect your calendar/video provider.
9. Add your Cal.com username/event IDs to `js/config.js`.
10. Deploy `supabase/stripe-webhook/index.ts` as a Supabase Edge Function.
11. Add STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and SUPABASE_SERVICE_ROLE_KEY as server secrets only.
12. Configure Stripe webhook events: checkout.session.completed, customer.subscription.created, customer.subscription.updated, customer.subscription.deleted and invoice.paid.
13. Deploy the frontend to a static host.
14. Embed the public page into Google Sites if desired.

Never expose Stripe secret keys or the Supabase service-role key in browser code.
