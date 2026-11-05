# IntelReap: infrastructure handoff and history

Read this first if you are a new agent or developer. Keep it current: **whenever you change infrastructure, deploys, data sources, branches or decisions, update this file in the same commit.** Last updated: 2026-11-05.

No secret values belong in this file, in commits or in chat. Secret *names* are fine.

## 1. The owner and how to work with them
- Works only from an Android phone: Termux plus the phone browser. No desktop.
- Wants **one complete command, pasted once, no placeholders**, explained for a beginner, with what to expect and what to paste back.
- Wants previews/screenshots before visual releases, plain-English explanations, and a status line during long work.
- Directive: **do not touch articles** (`learn/`, `guides/`, `docs/`, `scripts/content/` in the frontend repo). Another agent owns them and titles are keyword-mapped. Tell the owner first if a check flags an article.
- Decisions the owner has made: no paid services (free map tiles, no paid APIs, no Vercel subscription); keep the MaxMind database files; Abuja is their true location; show **both IPv4 and IPv6** on the identity panel; trading name is "Akin" (wording not yet applied to pages).

## 2. The product
intelreap.com: a free in-browser network and device scanner. 285 data points across 13 panels ("canvases"), each with a deep-dive page under `/intelligence/`. Goal: pass Google AdSense review (ca-pub ID is in the owner's AdSense account; verification tag, ads.txt and EEA/UK consent are still to do).

## 3. Architecture
| Part | Where | Notes |
|---|---|---|
| Frontend | GitHub `accessmakr/intelreap-frontend`, Netlify, auto-deploys `main` | static HTML/JS. A GitHub Action regenerates `sitemap.xml` and `pages.json` after every commit. |
| Backend (live) | GitHub `accessmakr/intelreap-backend`, **Cloudflare Worker** `intelreap-backend` at `https://intelreap-backend.accessmakr.workers.dev` | built automatically from branch **`cloudflare-worker`** only |
| Backend (legacy rollback) | Vercel project `intelreap-backend` (+ Upstash Redis) | unused by the site since the switch; deploys from `main`; to be deleted once the Worker has run clean for a while |

The frontend points at the Worker in `assets/js/config.js` and `service-worker.js` (frontend repo). Rollback = point those back at the Vercel URL.

## 4. Backend map
- `src/worker.js`: Worker entry. Routes `/api/health`, `ip-identity`, `ip-deep`, `proxy-intelligence`, `ai-summary`, `headers-echo`, `ipv6-check`. Turns a Worker request into the `req/res` objects the old Vercel handlers expect. CORS allowlist (intelreap.com, www, localhost). Answers HEAD like GET. Visitor IP comes from `cf-connecting-ip` only.
- `api/*.js`, `lib/*.js`: the original handlers, patched to run on both Vercel and Workers (`lib/runtime.js` detects Workers).
- `lib/cf-geo.js`: builds the identity/deep answers. **Primary source = local MaxMind-derived files; Cloudflare's `request.cf` data only if the local files have no record at all** (never mixed). Classifies networks by ASN number using `data/asn-classes.json`.
- `lib/geo-local.js`: reads the shard files through the Worker's `ASSETS` binding (binary search, in-memory cache).
- `scripts/build-geo-shards.js`: turns `data/geoip/*.mmdb` into `public/geo/**` (about 36 MB, about 1,280 small files, gitignored). Run automatically by wrangler's `build.command` on every deploy. Values live once in `public/geo/<db>/values/`. IPv6 is stored at /48 granularity.
- `wrangler.jsonc`: entry, aliases (`maxmind`, `@upstash/redis`, `node-fetch` are replaced by shims on the Worker), `assets` with `run_worker_first: true` (so the shard files are never public), build command.
- `data/geoip/GeoLite2-City.mmdb`, `GeoLite2-ASN.mmdb`: MaxMind data, committed (owner wants them kept). `data/asn-classes.json`: ASN classes from public-domain ipverse data.
- Workflows (`.github/workflows/`): `update-maxmind.yml`, `sync-peeringdb.yml`, `update-asn-classes.yml`.
- API extras: `GET /api/ip-identity?ip=<IPv4|IPv6>` looks up another address (used for the dual-address display). Invalid values are ignored.

## 5. How a lookup is answered
1. Visitor hits the Worker; IP from `cf-connecting-ip` (or `?ip=`).
2. `geo-local` loads one shard (a few hundred KB at most) from assets, finds the range, reads the value file. No outside call.
3. City value: `[country, regionCode, regionName, city, lat, lon, timezone, accuracyKm, continent]`. ASN value: `[asn, organisation]`.
4. `cf-geo` classifies the network (mobile/hosting/CDN by ASN number, then by name patterns).
5. `source` in the response is `maxmind-local` (or `cloudflare` when the local files had nothing). Identity and deep results are **never cached** on the Worker.
Verified: shard lookups were identical to the raw MaxMind databases on 4,000 random IPv4 and 4,500 allocated-network IPv6 addresses.
Known data limit: MaxMind (and Cloudflare) place MTN Nigeria IPv6 addresses wrongly (Lagos, Bida, Kano). IPv4 resolves to Abuja correctly. The UI should say location is approximate.

## 6. Deploy rules (these caused most confusion)
- Cloudflare builds **automatically only from `cloudflare-worker`** (production branch setting in the Cloudflare dashboard).
- **"Retry build" and "manual deploy" build `main`, which has no Worker config before the merge, and fail with "Could not detect a directory containing static files". Ignore those failures; do not press retry.**
- A failed build never replaces the live Worker.
- Pushing to backend `main` makes Vercel rebuild the legacy backend (harmless).
- Check build status via GitHub check run "Workers Builds: intelreap-backend" on the commit.
- Testing the Worker with curl needs browser-like headers (User-Agent, Origin https://intelreap.com, Accept, Accept-Language, Referer) or it answers "Automated access is not permitted".

## 7. Scheduled jobs and their history
- **MaxMind weekly job bug (fixed 2026-11-04, `3ac3e6a`):** the download script found the old file first, moved it onto itself and deleted the fresh download, so it reported success every week while the data stayed at the May 2026 build. Fixed; data refreshed (City built 2026-11-03, ASN 2026-11-04).
- **Repo growth:** now that the job works, each update adds about 60 MB of binary to git history. Repo was 66 MB on 2026-11-05. Deleting old files does not shrink history; only a history rewrite does (not wanted unless the repo nears 1 GB).
- **Planned fix, option B (owner quoted it as their choice, not built yet):** the scheduled job (every two weeks instead of weekly; the GeoLite2 licence, as far as known, expects updates within about 30 days: verify) force-replaces a branch `geo-data` containing only the newest database files; Cloudflare's build downloads from that branch; `main` stops receiving 60 MB commits. If the repo is made private, Cloudflare then needs a read token as a build variable.
- `sync-peeringdb.yml` still writes to Redis, which the Worker ignores, so `peeringdbData` is empty on the Worker. To be moved to a file.
- `update-asn-classes.yml` exists only on `cloudflare-worker`; **GitHub runs schedules only from the default branch (`main`), so it will not run until merged.**

## 8. Branch and merge state (2026-11-05)
Backend: `main` = fixed MaxMind job plus fresh data (`538ed0f`). `cloudflare-worker` = everything above, 11 commits ahead of `main`, nothing missing. `geo-shards` = same commit as `cloudflare-worker` for the geo work. `fix-maxmind-download` = merged. Not yet merged: `cloudflare-worker` into `main`.
Frontend: `main` is live. `panel-visuals` (1 commit, new VPN/device/graphics/security panel visuals, owner-approved from previews) is **not merged**; it merges cleanly with no overlapping files. The other agent commits straight to `main`, so always `git pull` first.

## 9. Frontend notes
- Netlify publishes the whole repo: `/docs/*.md` and `/scripts/content/base.html` are probably reachable on the public site. Suggested `netlify.toml` 404 rule for `/docs/*` and `/scripts/*` (coordinate with the other agent, who edits `netlify.toml`).
- Chart start-up is in `assets/js/visualizations/chart-boot.js`; captions in `viz-captions.js`; panel visuals in `panel-visuals.js` (branch only).
- Release helpers **live only on the owner's phone and are not in any repo**: `~/release.sh` and `~/work-tmp/live_check.py`. Known problems: it blocks on `scripts/content/base.html`, hard-codes 35 sitemap URLs and a 60-character title check, and hard-codes service worker version 1.7.0. Intended fix: make the title and sitemap checks warnings. Merging by hand has been used instead (tag first, then `git merge`, then run the live check).
- Search Console and keyword work: see the frontend `docs/` folder (other agent).

## 10. Open work (rough priority)
1. Merge `panel-visuals`; merge backend `cloudflare-worker` into `main` after a few clean days.
2. MaxMind option B (above) and the two-week schedule; move PeeringDB to a file.
3. Show both IPv4 and IPv6 (use `?ip=`) with an "approximate location" note; add the MaxMind credit line (footer, About "Data sources", Privacy), because MaxMind data is now used live. Needs the owner's wording approval.
4. Local summary engine (no scan data to any AI provider) and matching Privacy Policy text. Not started; the AI providers' model names are retired, so summaries currently fall back and the city shows "unknown".
5. Small visual fixes: route-diagram label overlap, odd stability chart shape, faint "Not Supported" tiles in dark mode, live charts restarting after a theme switch.
6. Backend cosmetics: `classificationSource: "ipapi-flags"` label, `strategyUsed: "cloudflare"` label, "Paid API Consulted" shows Yes whenever a mismatch triggers the check.
7. AdSense: trading-name line, verification tag, ads.txt, EEA/UK consent, re-check Search Console.
8. Unchecked: `proxy-intelligence` returned 403 on GET and 405 on POST in a local test; compare against the legacy Vercel behaviour.

## 11. Secrets (names only)
Cloudflare Worker secrets (optional): `GROQ_API_KEY`, `GEMINI_API_KEY`, `PROXYCHECK_API_KEY`, `IPQUALITYSCORE_API_KEY`. GitHub Actions secrets: `MAXMIND_ACCOUNT_ID`, `MAXMIND_LICENSE_KEY` (cannot be read back; copy from the MaxMind account if needed elsewhere). Legacy Vercel/Upstash: `KV_REST_API_URL`, `KV_REST_API_TOKEN`. A GitHub token with wide scopes was pasted into chats and shared transcripts in the past; treat any token that appeared in chat as exposed and rotate it.

## 12. Useful checks
- Live Worker (from Termux): curl `https://intelreap-backend.accessmakr.workers.dev/api/ip-identity` with the browser-like headers from section 6; expect `"source":"maxmind-local"`.
- Local test of the Worker: `npm ci`, `npx wrangler dev --local --port 8787`, send `cf-connecting-ip: <ip>`. Wrangler's placeholder `request.cf` is Austin, Texas, which is why local postal codes can look odd.
