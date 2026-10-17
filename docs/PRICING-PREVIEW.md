# Subscription pricing preview

This is a display-only catalog, configured in `src/lib/account/pricingPreview.ts`.
It does not populate commercial tables, grant entitlements or credits, start a
trial, activate AI, or call checkout. Free manual tools retain their existing behavior.
The public plans view is accessible to guests; other account sections still require sign-in.

| Plan | USD/month | ILS/month | Monthly AI credits |
| --- | ---: | ---: | ---: |
| Free | 0 | 0 | 0 |
| Starter | 15 | 46 | 80 |
| Pro | 35 | 108 | 240 |
| Business | 75 | 232 | 540 |

English displays explicit USD prices; Hebrew displays explicit ILS prices.
The ILS values are the supplied fixed rounded conversions based on the Bank of
Israel rate of 3.089 ILS per USD dated October 16, 2026. There is no live conversion.
Prices are provisional and may change before launch.

## Future implementation requirements (not activated)

- One credit represents $0.05 of actual AI API cost. Compute cost from actual
  provider usage and convert it to credits; do not assign fixed costs per feature.
  Processing can vary between architectural plans.
- Support fractional credits with precise accounting. Track consumption and
  remaining balances, including the monthly allocation.
- Enforce balances atomically on the server and protect against concurrent
  overspending, insufficient funds and unexpectedly expensive requests. Internal
  reservations, request limits and spending caps must be designed before launch.
- Show the actual available credit balance and, after an operation, the actual
  credits consumed. Never display an estimated operation cost before execution
  or expose internal API dollar costs to customers.
- Future checkout must charge the currency displayed and explicitly confirmed by
  the customer. Do not infer checkout amounts or currency from this preview.

These requirements supersede older proposals for fixed per-task credit pricing
and customer-facing operation estimates. Existing billing infrastructure, stored
balances and entitlement policies are unchanged by this preview.
