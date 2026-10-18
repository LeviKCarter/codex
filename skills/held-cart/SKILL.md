---
name: held-cart
description: Register a food order you built in Levi's Chrome and left at the checkout without paying, so his Pulse Ops voice phrase "finish that order" finds it. Use whenever a session (in any folder) builds a restaurant or delivery cart for Levi and stops at the checkout or payment step unpaid — POST it to http://localhost:3000/api/order-unfinished. Never send a cart that was paid for, or one you are unsure about.
---

# held-cart: tell the dashboard about a cart you left at the checkout

Why this exists: Pulse Ops' voice phrase "finish that order" starts again the last food order that ended unplaced,
and pays only after Levi says go. It only knows about a cart someone told it about. On 2026-10-18 an Illegal Pete's
cart a session left at the checkout ($15.87, unpaid) was not found, because nothing registered it. The rule used to
live only in the PulseOps `CLAUDE.md` (section "A food cart you leave at the checkout"), which sessions outside
`C:\Users\levik\Documents\Codex` never load; this skill is the global copy. Keep the two in step.

## When it applies

When Levi has you build a food order in his Chrome and you stop at the checkout without paying, tell the dashboard,
so "finish that order" finds it. POST it to the live dashboard, then say in your reply that it is kept:

```bash
curl -s -X POST http://localhost:3000/api/order-unfinished -H 'content-type: application/json' -d '{"restaurant":"Illegal Pete'\''s - Colfax","items":"Chicken burrito (black beans, mild salsa), chips and queso","total":"$15.87","location":"1530 E Colfax Ave, Denver","orderUrl":"https://order.illegalpetes.com/","paid":false}'
```

- `restaurant`: required.
- `items`: the cart as the checkout lists it. Or `want`: what he asked for. At least one of the two.
- `total`, `location` (the store's address), `orderUrl` (http or https): send them when the checkout shows them.
- `paid` must be `false`.

Send it only when nothing was paid: a cart you paid for, or are unsure about, is never sent, since finishing it would
charge him twice. The route only writes a file on the PC; it never pays or places anything (PulseOps
`docs/order-assistant.md`, "Finishing an order from earlier"). It keeps one cart; a new POST replaces the last.

## Check it took

The reply is JSON with `"ok":true` and the kept cart under `unfinished`. If it is anything else (the dashboard is
down, the route answers 404, or `ok` is false with an `error`), say plainly in your reply that the cart was NOT
registered and why, so Levi knows "finish that order" will not find it. Don't retry with different data to force it
through.
