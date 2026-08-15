# Security notes

Triage of the security posture as of this change set. The point of this file is to turn
"we ignored a security scan" into "we ran it and here is the assessment."

## npm audit — 3 high-severity advisories (all triaged, none runtime-exploitable here)

`npm audit` reports 3 high-severity advisories. **All three are build/dev-time
dependencies pulled transitively through Next.js, and the only offered fix is a
major-version bump to Next 16** (`fixAvailable: next@16.3.1, isSemVerMajor: true`) — i.e.
a breaking framework upgrade, not a `npm audit fix`. Assessment per advisory:

| Package | Severity | Direct? | Advisory | Reachable in this app? |
|---|---|---|---|---|
| `postcss` (≤8.5.22) | high | no (via `next`) | GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp, GHSA-r28c-9q8g-f849 — XSS/path-traversal via attacker-controlled `sourceMappingURL` in CSS | **No.** PostCSS runs at **build time** on our own first-party CSS (Tailwind). There is no path by which an attacker supplies CSS to our PostCSS pipeline at runtime. |
| `sharp` (<0.35.0) | high | no (via `next`) | GHSA-f88m-g3jw-g9cj — inherited libvips CVEs | **No.** `sharp` is only used by `next/image` for image optimization. `next/image` is **not imported anywhere** in this codebase (verified by grep), so the vulnerable image-processing path is never exercised. |
| `next` (range) | high | yes | the two above, surfaced through Next's pinned resolutions | Same as above — the flag is Next's internal pin of the vulnerable postcss/sharp versions, not a distinct runtime issue. |

**Decision: accepted, not patched, for this submission.** Upgrading to Next 16 is a
major version jump that risks breaking the App Router / build config for zero real
security gain here (neither vulnerable code path is reachable at runtime). The honest
engineering call is to document the assessment rather than take a breaking upgrade under
time pressure. If this were going to production, the fix is a scheduled, tested Next 16
migration — tracked, not rushed.

To reproduce: `npm audit` (summary) or `npm audit --json` (full advisory detail).

## API keys — action required before the repo/demo goes public

These are **your** actions — they can't be done from code:

1. **Rotate the Yelp API key.** The key used during development was pasted into a chat and
   must be treated as **compromised**. Regenerate it in the Yelp developer dashboard and
   put the new value only in `.env.local` (which is git-ignored — verified). Never commit
   it.
2. **Restrict the Google Maps browser key.** `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is, by the
   `NEXT_PUBLIC_` convention, bundled into client-side JS and therefore public to anyone
   who opens the app. That is only safe if the key is **HTTP-referrer-restricted** in the
   Google Cloud console (and scoped to just the Maps JS / Places APIs it needs). Confirm
   this restriction is set before deploying any public demo URL, or the key is a live
   billing/abuse vector.

## Secrets hygiene (already in place)

- `.gitignore` covers `.env`, `.env.local`, `.env*.local` (verified). No secret is
  committed; `.env.example` carries only empty variable names as documentation.
- Every external adapter (Supabase, Google, Yelp, Anthropic) is off by default and
  activates only when its env var is set, so a fresh clone runs with no secrets at all.
