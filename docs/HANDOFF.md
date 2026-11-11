# IntelReap: infrastructure handoff and history

Read this first if you are a new agent or developer. Keep it current: **whenever you change infrastructure, deploys, data sources, branches or decisions, update this file in the same commit.** Last updated: 2026-11-05 (second address, on-device summaries, licence notes).

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
- `scripts/fetch-geo-data.js`: run first by the Cloudflare build; downloads the newest MaxMind files from the private data repository through the GitHub contents API (see section 7). Without `GEO_DATA_REPO` it uses whatever is already in `data/geoip/`.
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
- **Data pipeline (private repo, built 2026-11-05):** the MaxMind licence forbids sharing the databases, so they must never be in this public repo. `update-maxmind.yml` (1st and 15th) downloads the databases with the `MAXMIND_*` secrets and force-pushes only the two files plus `BUILT.txt` (history discarded) to a **private repository in a separate GitHub account**, named by the `GEO_DATA_REPO` secret (`owner/name`) using the write key in `GEO_DATA_PUSH_TOKEN`. It then pushes a one-line stamp (`data/geo-stamp.txt`) to the build branch (`DEFAULT_BUILD_BRANCH` in the workflow, currently `cloudflare-worker`; change to `main` if Cloudflare's production branch changes) so Cloudflare rebuilds. The build runs `scripts/fetch-geo-data.js` (needs Cloudflare **build variables** `GEO_DATA_REPO` and a read-only `GEO_DATA_TOKEN`) and then `scripts/build-geo-shards.js`. If the download fails and no files exist, the shard build fails, the deploy stops and the live Worker keeps running. If a secret is missing the job fails before publishing anything. Fine-grained keys expire (maximum one year): renew them and update both places. Status on 2026-11-05: code merged; private repo, keys and Cloudflare variables NOT yet set up; the committed copies in `data/geoip/` and the public `geo-data` branch still exist and must be removed once the private path is verified (see 10b).
- `sync-peeringdb.yml` still writes to Redis, which the Worker ignores, so `peeringdbData` is empty on the Worker. To be moved to a file.
- `update-asn-classes.yml` exists only on `cloudflare-worker`; **GitHub runs schedules only from the default branch (`main`), so it will not run until merged.**

## 8. Branch and merge state (2026-11-05)
Backend: `main` = fixed MaxMind job plus fresh data (`538ed0f`). `cloudflare-worker` = everything above, 11 commits ahead of `main`, nothing missing. `geo-shards` and `geo-data-pipeline` = merged into `cloudflare-worker`. `geo-data` = data-only branch maintained by the workflow (do not edit by hand). `fix-maxmind-download` = merged. `cloudflare-worker` was merged into `main` on 2026-11-05 (both branches now identical in content; keep building production from `cloudflare-worker` until the owner switches Cloudflare's production branch to `main`, then change `DEFAULT_BUILD_BRANCH` in the workflow).
Frontend: `main` is live and contains `panel-visuals`, `second-address` and `local-summary` (rollback tags `pre-release-panel-visuals`, `pre-release-second-address`, `pre-release-local-summary`). The other agent commits straight to `main`, so always `git pull` first.

## 9. Frontend notes
- Netlify publishes the whole repo: `/docs/*.md` and `/scripts/content/base.html` are probably reachable on the public site. Suggested `netlify.toml` 404 rule for `/docs/*` and `/scripts/*` (coordinate with the other agent, who edits `netlify.toml`).
- Chart start-up is in `assets/js/visualizations/chart-boot.js`; captions in `viz-captions.js`; panel visuals in `panel-visuals.js` (branch only).
- Release helpers run on the owner's phone; **the master copies are in this repo at `docs/phone-scripts/`** (README there has the one-line install). Owner's rules: no hard-coded counts (sitemap size) and no rules about article titles in any check.
- Search Console and keyword work: see the frontend `docs/` folder (other agent).

## 10. Done on 2026-11-05 (frontend)
- `panel-visuals` merged (VPN, device, graphics, security panels), with fallbacks for `--seg`/`--chip` so the static checks pass.
- **Second address:** `assets/js/engines/ip.js` `fetchAltAddress` finds the other family through `api.ipify.org` / `api6.ipify.org`, then calls `/api/ip-identity?ip=<other>`. Rendered by `canvas-2.js` into rows `c2-alt-row`, `c2-alt-loc-row`, `c2-accuracy-row` (homepage and `/intelligence/network-identity`). Silent on any failure.
- **Summaries are written on the device** (`assets/js/engines/ai-summary.js`): no AI provider, no backend call, no "unknown" filler. The backend `ai-summary` endpoint is now unused (Groq/Gemini keys are not needed). Panel labels were renamed from "AI Analysis" to "Analysis". Only the English translation file was updated for the renamed Summary Source label; the other 23 languages still say "AI Summary Source".
- **MaxMind credit** is on `about.html` (How it works) and in the Privacy Policy third-party list. Not in the footer or on every page, by the owner's request.
- Privacy Policy, About, Terms, FAQ JSON-LD and the live-feed page were updated to match.

## 10b. MaxMind licence notes (GeoLite EULA, read 2026-11-05; current text dated 2026-02-12; not legal advice)
- Attribution is required where GeoLite data use is documented or advertised. Sentence used: "This product includes GeoLite Data created by MaxMind, available from https://www.maxmind.com."
- Old database versions must be deleted within 30 days after a newer release, and the databases must not be shared with others. Owner decision (2026-11-05): keep the databases only in a private repository in a separate GitHub account; keep this code repository public; remove the committed copies, the public `geo-data` branch and the old history. Dry run of the history rewrite (git filter-repo, mirror copy) took the repo from 67 MB to 0.3 MB with no database files left and code identical apart from `data/geoip/`. To do after the private path is verified: take a backup bundle, delete branches `geo-data`, `geo-data-pipeline`, `geo-shards`, `fix-maxmind-download`, remove `data/geoip/` from the tree, rewrite history, force-push `main` and `cloudflare-worker`. The `lib/geoip.js` file name appears in the history listing only because of its path; it is code and stays.

## 10c. Done on 2026-11-06/07 (frontend)
- Header: IR logo (CSS `::before`, 28 px on phones, 32 px otherwise) beside the wordmark on every page; fluid wordmark and compact controls so logo, wordmark, search, theme, language and menu fit on one row from 320 px up (theme button hides at 340 px or less). Tested with the real Syne font. The sandbox cannot load Google Fonts, so tests need `@fontsource` copies (see how `/tmp/shoot.py` was built: Playwright + local servers; both servers must be started in the same command as the test).
- Charts: numbers inside dials, vitals bars against their own targets, titles, collecting-data notes, capability labels fit, route diagram nodes named by role with the full text in a hover title, more readable unsupported tiles.
- Captions on the homepage now follow each canvas's own id.
- AdSense prep: `<meta name="google-adsense-account">` on the homepage only and `ads.txt`. EEA/UK consent is NOT built: a Google-certified consent tool is required for EEA/UK ads (use Google's own "Privacy & messaging" in the AdSense account after approval).
- The AI wording was removed from summary labels in all 24 languages (check native wording of the Swahili labels, which were edited by hand).

## 10c2. Identity and E-E-A-T (owner decision 2026-11-08: Option B, brand only)
- The site is presented as "IntelReap, an independent project". There is NO legal-entity claim ("IntelReap Information Technologies" was removed everywhere, including schema `legalName`, the footer line and the 24 translation files) and no trading-name line.
- Public email `stmakarios@gmail.com` appears **only on `contact.html`**. Everywhere else the contact route is a hyperlink to `/contact` (footer link, legal pages, schema `contactPoint`). Do not paste the address elsewhere. The article template `scripts/content/base.html` was updated the same way; the 40 existing pages got the same mechanical clean-up (footer link and hidden schema only).
- New page `/methodology` ("How IntelReap works"): per-panel sources, accuracy, freshness, independence, corrections, credits. Linked from About and in the sitemap (via the route generator). Its `.html` redirect is in `netlify.toml`.
- For the content owner (other agent): articles still list the Organization as author with no named person. If person bylines are wanted later, that needs the owner's decision about showing a name.
- `verify6b.py` no longer expects `footer.operated_by` (key removed).

## 10d. Open work (rough priority)
1. Finish the private data repository (owner creates the separate account, repo and key; see section 7), then the cleanup in 10b. The 15 Nov job fails safely until then.
2. Move PeeringDB to a file (the weekly job still writes to Redis, which the Worker ignores).
3. (done 2026-11-08) Stability chart history now survives a theme switch; the theme switch redraws charts in place, the page does not reload.
4. Backend cosmetics: `strategyUsed: "cloudflare"` label (done 2026-11-08: `classificationSource` now `network-flags`; `paidAPIConsulted` is true only when a provider answered).
5. AdSense: apply for the account when ready; add the verification snippet Google gives; consent tool after approval; re-check Search Console.
6. Unchecked: `proxy-intelligence` returned 403 on GET and 405 on POST in a local test; compare with legacy Vercel behaviour.
7. (done 2026-11-08) `/docs/*` and `/scripts/*` return 404 through `netlify.toml` rules at the top of the redirects list (the other agent edits that file too: keep them).
8. Privacy Policy and other legal text are English only for the new wording.

## 11. Secrets (names only)
GitHub Actions secrets for the data pipeline: `GEO_DATA_REPO` (owner/name of the private data repository), `GEO_DATA_PUSH_TOKEN` (fine-grained key with Contents read/write on that repository only). Cloudflare build variables: `GEO_DATA_REPO`, `GEO_DATA_TOKEN` (read-only key). Cloudflare Worker secrets (optional): `GROQ_API_KEY`, `GEMINI_API_KEY`, `PROXYCHECK_API_KEY`, `IPQUALITYSCORE_API_KEY`. GitHub Actions secrets: `MAXMIND_ACCOUNT_ID`, `MAXMIND_LICENSE_KEY` (cannot be read back; copy from the MaxMind account if needed elsewhere). Legacy Vercel/Upstash: `KV_REST_API_URL`, `KV_REST_API_TOKEN`. A GitHub token with wide scopes was pasted into chats and shared transcripts in the past; treat any token that appeared in chat as exposed and rotate it.

## 12. Useful checks
- Live Worker (from Termux): curl `https://intelreap-backend.accessmakr.workers.dev/api/ip-identity` with the browser-like headers from section 6; expect `"source":"maxmind-local"`.
- Local test of the Worker: `npm ci`, `npx wrangler dev --local --port 8787`, send `cf-connecting-ip: <ip>`. Wrangler's placeholder `request.cf` is Austin, Texas, which is why local postal codes can look odd.
