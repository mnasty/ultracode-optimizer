# charter: dusk tarot

These are the project rules for Dusk Tarot. They add to `CHARTER.md` and are read whenever the work touches `/Users/mick/dev/web/memi` (the real app), `/Users/mick/dev/web/dusk-design-archive`, or a `dusk-*` scratch folder.

## Places

- **The real app:** `/Users/mick/dev/web/memi`, repo `github.com/mnasty/dusk-tarot`. On 2026-10-31 the owner approved the round 4e design for implementation and allowed the memi codebase to be overwritten. It is being rebuilt from scratch as Dusk Tarot (dusktarot.com, new resources, no mention of memi, every memi-only feature deleted). The old memi states are preserved by the owner. Infrastructure is wired, not provisioned: never create or change a live Turso DB, Cloudflare resource, SES identity or API key without asking. `.dev.vars` is gitignored (it was never tracked); the owner doesn't mind dev secrets in it, so don't flag it.
- **The design archive** (durable): `/Users/mick/dev/web/dusk-design-archive/`. It holds:
  - `round*/requirements-*.md`, the owner's verbatim feedback;
  - `dusk-v2-build/`, the mirrored build;
  - `RESUME.md`.
- **The prototype build** (volatile scratch): `dusk-v2-build/src-v4.html` is built by `build-v4.py` (or `build-any.py SRC OUT`) into `dusk-design/direction-dusk-v4.html`. Checkpoints are in `dusk-v2-build/ckpt/` and the regression suites in `dusk-v2-build/v4tests/` (r4-pool, r4-cards, the successor suites). The preview is built by `v4-preview/inline-v4d.py` and must stay under 16 MB with 0 `file://` refs.

## The owner's taste

- **Keep it simple.** Do the simplest thing that meets the owner's words. Never invent visual systems or devices beyond what's asked, and never turn one preference into an engine. "Very small adjustment" means very small.
- **Legibility comes from the text's own colour.** No ribbons, plates, bands, boxes or sky windows. The sun or moon may sit behind text. The only exception is soft shading clipped to the disc (Z8): the moon's is darker, the sun's lighter (E1).
- **Proof-of-concept scope.** Take the cheapest correct approach and leave production plumbing out of the prototype. Note what the real app needs separately.
- **Don't regress what's finished.** Everything not named in a round is done. That goes above all for what the owner praised:
  - the 1909 cards;
  - the sun and moon mascots;
  - the house lighting;
  - every weather scene and the dark day rain;
  - the graveyard pick screen;
  - the time-of-day headlines;
  - the moon's shading.
- **Identity:**
  - gothic Gorey, with buttons shaped like coffins;
  - all text lowercase;
  - one step per screen;
  - the real time of day, with the sun and moon at their real positions;
  - must not resemble Co-Star;
  - the logo is option a (no lashes) with a lilac D;
  - memi's funMessages verbatim (V6);
  - "ask universe" → "continue";
  - "explain it to me" for the AI reading (Y7);
  - the actions sit above the reading (Y8);
  - rounded cards and no horizontal scroll (Y6);
  - no visible scrollbars in dialogs (Y1);
  - R14: no backdrop-filter, transform/opacity motion only, reduced motion respected, text ≥ 12px, targets ≥ 44px.

## Testing specifics

- **Viewports:**
  - phones: 360×640, 375×667, 390×700, 390×844, 412×780, 412×915, 430×932;
  - tablets: 768×1024, 800×1280 (the owner's Android tablet), 820×1180, 1024×768;
  - desks: 1280×800, 1366×768, 1440×900, 1920×1080, 2560×1440.
- **Driving the page:** `window.__dusk` drives it for tests (`go`, `jumpTo`, `S`, `sky.setWall` / `setCity` / `setWeather`, `mascot`, `logo`, `favicon`, …). Keep it working.
- **Known noise in the full regression:** b6-plain-contrast around 311–313/376, b6-plain-tone 2/5, and b9-fix-smoke's 1440 vii overlap count 6 vs 7.
