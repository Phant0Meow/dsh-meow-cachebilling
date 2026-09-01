# meow-cachebilling

[简体中文](./README.md) | English

Am I the only one who cares about saving money? Are you all made of money or something...

## Why this plugin exists

DeepSeek's cache hit rate is high, the server-side cache handling is solid, and prices are cheap — which is probably why so many people overlook this:

however cheap the unit price, a growing context keeps getting more expensive.

By the end, what you actually pay can be 90%+ pure cache cost.

In other words: with a better window-switching strategy, your DeepSeek bill can drop substantially.

This is real. I spent two days switching windows diligently, and it really did get cheaper.

I had GPT run the numbers. The logic goes like this:

Cache hits are all previously-seen context, carried along every round — that's why they look so big.

But missed input and AI output are the hard, irreducible actual usage, right?

So maybe "actual usage" is the fair yardstick for comparing how much two days' work really cost.

GPT's math said diligent window-switching saved me 50.1%.

<img width="404" height="260" alt="bdf3b8aafe29f33c510cedfee116ed5d" src="https://github.com/user-attachments/assets/fbe0fc75-5e91-44f3-b871-4ebb8d736767" />

So the correct way to use DeepSeek:

Keep opening new windows, and never touch old ones again.

Every time you use a very long old window, you pay a lot for its cache.

And an old window whose server-side cache has already expired? Presumably sky-high — everything bills as miss.

Never touching old windows is the optimal play.

(Which is where a memory plugin comes in, to carry the useful stuff out of old windows.)

But when exactly to switch windows — that's your call.

The cost of switching:

The miss-cost of the AI re-reading code (reducible with fork).

The human cost of re-explaining the task and your rules (reducible with a memory plugin).

The benefit of switching:

Cache costs reset to zero and start accumulating from scratch.

There's a cost and a benefit, so you need to judge good timing.

Switch too early: cache was still cheap, little to gain; wasted re-read misses, and repeating yourself is tiring.

Switch too late: your bill has already been quietly eaten by the bloated context.



So I needed a plugin that tells me: this round, how much money did the pure context-cache part cost me?

Only then can I have a feel for when to switch windows.


So this plugin exists.


Before writing it I searched the whole dsh-plugin tag — plenty of billing plugins, but nobody tracks this one thing... Strange. Am I the only one who needs it?

But it really does save money...

## Features

- **Third-party relays welcome**: not limited to the official DeepSeek route — official routes price exactly off the rate card; any relay that reports usage gets billed too. Models on the rate card price off the card (peak/valley or flat); unmatched ones estimate at flash rates with an "estimate" tag in the bill. Routes with no provider at all stay hidden.
- **Visual rate-card editor**: a dedicated "Meow Cache Billing" tab in the settings page (sibling of General / Models) — add, edit, or restore prefill entries, effective immediately without a restart. `rates.yml` at the package root is the shipped prefill layer (provider/model exactly as the API reports them, peak/valley (days × ranges cross product) or flat `const`, timezone per provider billing zone (IANA name)); editing it needs a `dsh web` restart. Broken entries are skipped with a console warning — it can never crash DSH.
- **The bill lives in the context menu**: click the context ring beside the composer and the bill sits at the bottom of its panel, right next to "how much context is used"
- **Three timing tiers in one borderless table**: each row (current API call, current turn, session total) leads with its total price — the currency unit is noted once in the header — followed by cache-hit, cache-miss and output columns
- **Session total**: the whole session is priced call by call at each call's own peak/valley rate. Two per-call counters, both derived from the usage fields the API returns — "cache invalidations": the call reported cache-write tokens (a write means the prefix changed and the old cache was invalidated; the official API doesn't report this field, only some relays do); "full misses": the call had input but zero cache hit (derived from the reported hit count; a session's first call, with nothing to hit yet, counts too)
- **Automatic peak/off-peak pricing**: weekday peak hours (Beijing time 09:00–12:00 / 14:00–18:00) bill at peak rates; all other hours plus Saturdays and Sundays bill at half-price valley rates — independent of your system timezone, computed purely from event time. The footer writes 梁文峰/梁文谷 on official DeepSeek routes, plain "peak/valley" elsewhere, "flat rate" for const entries, and tags estimates explicitly
- **Per-model pricing**: V4 Flash / V4 Pro / V4 Flash Vision Exp differ; each call is priced by the model that actually served it
- **Readable amounts**: adaptive precision — below 0.01 the amount is rounded to one significant figure, so tiny fractions like 0.005 or 0.0003 stay visible; at 0.01 and above it is rounded to the cent
- **Average cost curve**: the plugin keeps each session's per-step real cost (only steps priced off the rate card; a model tag is written only when the model or peak/valley changes) and aggregates an average cumulative curve for the current model across the last 30 days of sessions, plotted with the current session's actual cumulative spend on one chart — slow at first, then steep, roughly quadratic — so you can switch the window or compress context before costs take off

## Install

```sh
dsh plugin --profile web add github:Phant0Meow/dsh-meow-cachebilling
```

Restart `dsh web` after installing. Zero configuration.

## Pricing rules

| Item | Rule |
|---|---|
| Cache | cacheRead tokens this round × hit price |
| Miss | (missed input + cache write) × miss price |
| Output | output tokens × output price |
| Window | weekdays 09:00–12:00 / 14:00–18:00 are peak; everything else (incl. weekends) is valley |

Built-in price table (CNY per million tokens, official rate card of 2026-08-17):

| Model | Peak (hit/miss/output) | Valley |
|---|---|---|
| deepseek-v4-flash | 0.1 / 3 / 9 | 0.05 / 1.5 / 4.5 |
| deepseek-v4-pro | 0.3 / 9 / 27 | 0.15 / 4.5 / 13.5 |

Data source: `usage.cacheReadTokens` (`prompt_cache_hit_tokens` in DeepSeek's API). This plugin is a local estimate; actual billing is up to your DeepSeek invoice.

On third-party relays the rate card may differ — matched models estimate at the card price, unmatched ones at flash price. Still a local estimate; actual billing is up to your invoice. The editable rate card is `rates.yml` at the package root; the tables above are the built-in defaults.

## Notes

- Official DeepSeek routes price exactly; third-party relays estimate, tagged as such when the model isn't on the rate card.
- Calls without a reusable prefix honestly show a small miss cost — the first call of a fresh session has nothing to reuse yet.
- The rate card has two layers: `rates.yml` at the package root is the shipped prefill (follows version updates); the "Meow Cache Billing" settings tab is your layer, effective immediately. A broken `rates.yml` falls back to the built-in defaults with a console warning.

## Credits

The three timing tiers (current API call / current turn / session total), third-party relay support and the cache-invalidation stats come from a major rewrite by [better-er](https://github.com/better-er) ([#2](https://github.com/Phant0Meow/dsh-meow-cachebilling/pull/2)); the 梁文峰/梁文谷 peak/valley pun in the bill footer is his idea too — we found it fun and kept it. The peak/valley pricing itself is this plugin's own feature, which his version carried over as-is. Thank you!

## License

MIT
