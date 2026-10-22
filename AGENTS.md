<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Camera Insights — notes for whoever works on this

- Separate from MATO Info on purpose (Xin, 22-10-2026: "a separate program that's not connected to mato
  vending"). Own repo, own Vercel project, own password. Shares only the Supabase project (free) and the UniFi
  call count `unifi_call_take` with it.
- **Database changes only additive.** The same Supabase project runs MATO Info live; never drop or change
  anything that is not `ci_*`. Every table here is `ci_*`, RLS on, service role only.
- **Never store pictures, faces, ages or card data.** `parseProtectEvents` and `saleRow` decide what is kept;
  tests guard both.
- **Every number that suggests a change or ranking goes through `src/lib/stats.ts`** (×4 dispersion measured on
  MATO's data, 30 minimum, Bonferroni for best-of-7/24). Grey "about the same" for noise, never coloured.
- **Every text in both `src/i18n/en.ts` and `src/i18n/nl.ts`** (the test checks the keys match). Belgian formats
  via `src/i18n/format.ts`, always Europe/Brussels.
- Every page and action checks the login itself (`requireLogin`), not only the proxy.
- New colours are tokens in `globals.css`, light and dark. Charts are plain CSS bars (`Bars`, `BarList`).
- Run `npm test`, `npm run lint`, `npm run build` before pushing.
