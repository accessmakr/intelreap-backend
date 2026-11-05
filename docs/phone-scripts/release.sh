#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
REPO="${REPO:-$HOME/intelreap-frontend}"
cd "$REPO"
export W="$HOME/work-tmp"
mkdir -p "$W"
SITE="${SITE:-https://intelreap.com}"
BRANCH="${1:-}"
MARK_PATH="${2:-/service-worker.js}"
MARK_TEXT="${3:-}"
if [ -z "$BRANCH" ] || [ -z "$MARK_TEXT" ]; then
  echo "usage: bash ~/release.sh <branch> <live-file-path> <text-that-appears-when-live>"
  echo "example: bash ~/release.sh batch0b-fixes /service-worker.js intelreap-v1.7.0"
  exit 1
fi

echo "=================== GUARD"
if [ -n "$(git status --porcelain)" ]; then
  echo "ABORT: working tree not clean"
  git status --short
  exit 1
fi
git fetch origin
git switch "$BRANCH"
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/$BRANCH)" ]; then
  echo "ABORT: local $BRANCH and origin/$BRANCH differ. Push the branch first."
  exit 1
fi
echo "branch $BRANCH is complete and pushed"

cat > "$W/live_check.py" <<'PYR1'
import json
import os
import re
import sys
import urllib.error
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "https://intelreap.com").rstrip("/")
SERVER = os.environ.get("SKIP_SERVER") != "1"
HDR = {"User-Agent": "intelreap-live-check"}
fails = 0
passes = 0


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def fetch(path):
    url = path if path.startswith("http") else BASE + path
    req = urllib.request.Request(url, headers=HDR)
    try:
        r = OPENER.open(req, timeout=30)
        return r.status, r.headers, r.read().decode("utf8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read().decode("utf8", "replace")
    except Exception as e:
        return 0, {}, str(e)


def rep(name, ok, extra=""):
    global fails, passes
    if ok:
        passes += 1
    else:
        fails += 1
    print(("OK    " if ok else "FAIL  ") + name + (" " + str(extra) if extra and not ok else ""))


def section(t):
    print("=================== " + t)


section("ASSETS (must return 200)")
for p in ("/favicon.ico", "/assets/images/icons/icon-192.png",
          "/assets/images/icons/icon-512.png",
          "/assets/images/icons/maskable-icon-512.png",
          "/assets/images/icons/apple-touch-icon.png",
          "/assets/images/og-image.png", "/manifest.json",
          "/js/ad-slots.js", "/js/analytics-consent.js",
          "/assets/js/utils/redact.js", "/service-worker.js",
          "/robots.txt", "/sitemap.xml",
          "/assets/js/i18n/translations/es.js"):
    code = fetch(p)[0]
    rep("%s -> %s" % (p, code), code == 200, code)

section("THEME, LANGUAGE AND SERVICE WORKER FILES")
code, h, css = fetch("/assets/css/ndic-design-system.css")
rep("design system has the theme tokens", "THEME TOKENS" in css)
code, h, rc = fetch("/js/root-config.js")
rep("root-config has the new theme logic", "THEME_KEY" in rc and "ensureThemeButton" in rc)
code, h, sw = fetch("/service-worker.js")
rep("service worker is a current version", bool(re.search(r"intelreap-v1\.(5|6|7|8|9)\.\d+", sw)))
code, h, es = fetch("/assets/js/i18n/translations/es.js")
rep("Spanish file has the new hero strings", "title_html" in es)

section("SITEMAP AND EVERY PAGE IN IT")
code, h, sm = fetch("/sitemap.xml")
locs = re.findall(r"<loc>([^<]+)</loc>", sm)
rep("sitemap lists 35 URLs", len(locs) == 35, len(locs))
rep("sitemap has no utility pages",
    not any(x in sm for x in ("/410", "/offline", "pinterest")))
HEADTHEME = "matchMedia('(prefers-color-scheme: dark)')"
for loc in locs:
    path = loc.replace("https://intelreap.com", "") or "/"
    code, h, body = fetch(path)
    canon = re.search(r'<link rel="canonical" href="([^"]+)"', body)
    title = re.search(r"<title>(.*?)</title>", body, re.S)
    problems = []
    if code != 200:
        problems.append("status %s" % code)
    if not canon or canon.group(1) != loc:
        problems.append("canonical %s" % (canon.group(1) if canon else None))
    if title and len(title.group(1)) > 60:
        problems.append("title %d chars" % len(title.group(1)))
    if "ndic-footer-inner" not in body:
        problems.append("no static footer")
    if HEADTHEME not in body:
        problems.append("no head theme script")
    if "googletagmanager.com" in body:
        problems.append("analytics loads without consent")
    if "ICBM" in body:
        problems.append("fake geo tag")
    if "noindex" in body:
        problems.append("noindex")
    rep("page " + (path or "/"), not problems, "; ".join(problems))

section("BATCH 0: MENU, TOKENS, NAVIGATION AND TITLES")
code, h, ms = fetch("/js/menu-system.js")
rep("mobile drawer uses both class names", ms.count("ndic-mobile-drawer--open") == 2)
code, h, css = fetch("/assets/css/ndic-design-system.css")
rep("no self-referencing colour tokens",
    not re.search(r"(--[a-z0-9-]+)\s*:\s*var\(\s*\1\s*\)", css))
code, h, rg = fetch("/js/registry.js")
rep("Learn and Guides are in the navigation", "id: 'learn'" in rg and "id: 'guides'" in rg)
for path, want in (
        ("/learn/can-you-have-two-isps-in-one-house",
         "Can You Have Two Internet Providers in One House?"),
        ("/guides/how-to-enable-webgl",
         "How to Enable WebGL in Chrome, Firefox and Safari"),
        ("/learn/does-a-vpn-change-your-mac-address",
         "Does a VPN Change or Hide Your MAC Address?"),
        ("/learn/what-is-vpn-passthrough",
         "What Is VPN Passthrough? PPTP and IPsec Explained")):
    body = fetch(path)[2]
    t = re.search(r"<title>(.*?)</title>", body, re.S)
    rep("title " + path.split("/")[-1], bool(t) and t.group(1).startswith(want), t.group(1) if t else None)

section("BATCH 0b: HEADER, CLEAN ADDRESSES, CACHE AND OLD PAGES")
code, h, css0 = fetch("/assets/css/ndic-design-system.css")
rep("header can stay at the top (body clips, no scroll box)",
    re.search(r"body \{[^}]*overflow-x: clip", css0) is not None)
code, h, home0 = fetch("/")
rep("no search template in the homepage data", "SearchAction" not in home0)
for p in ("/about", "/contact", "/privacy-policy", "/cookies-policy", "/terms-of-use"):
    body = fetch(p)[2]
    c = re.search(r'<link rel="canonical" href="([^"]+)"', body)
    rep("canonical is clean on " + p, bool(c) and c.group(1) == "https://intelreap.com" + p,
        c.group(1) if c else None)

section("HOMEPAGE")
code, h, home = fetch("/")
rep("deep-dive links carry real addresses",
    not re.search(r'href="#"[^>]*ndic-deep-dive-link', home))
rep("footer links are in the raw HTML",
    len(re.findall(r'<footer id="ndic-footer">.*?</footer>', home, re.S)[0].split("href=")) > 20)
rep("no fake rating", "4.9" not in re.sub(r"<svg.*?</svg>|<script.*?</script>", "", home, flags=re.S))
rep("stats say 285 data points and 13 panels",
    "285 data points" in home and "13 intelligence panels" in home)
rep("hero is marked for translation", 'data-i18n-html="hero.title_html"' in home)

section("HUBS")
for hub in ("/learn/", "/guides/", "/intelligence/"):
    code, h, body = fetch(hub)
    rep("%s serves a real hub page" % hub,
        code == 200 and "hub-card" in body and ("canonical\" href=\"https://intelreap.com%s\"" % hub) in body,
        code)

section("LANGUAGE ENGINE ON PAGES THAT HAD NONE")
for p in ("/about", "/contact", "/privacy-policy", "/learn/"):
    rep(p + " loads the language engine", "i18n-engine.js" in fetch(p)[2])

section("LEGAL AND TRUST PAGES")
code, h, priv = fetch("/privacy-policy")
rep("privacy policy names the operator and email",
    "IntelReap Information Technologies" in priv and "stmakarios@gmail.com" in priv)
rep("privacy policy has no old absolute claims",
    not re.search(r"zero personal data|collects no personal data|nothing leaves your device", priv, re.I))
code, h, ck = fetch("/cookies-policy")
rep("cookies policy has the settings anchor", 'id="cookie-settings"' in ck)

if SERVER:
    section("SERVER BEHAVIOUR")
    for p in ("/download", "/download/abc", "/video", "/video/abc", "/yt/abc",
              "/convert", "/get", "/fetch/abc"):
        code = fetch(p)[0]
        rep("%s -> %s (410 expected)" % (p, code), code == 410, code)
    code = fetch("/zz-not-a-real-page")[0]
    rep("unknown page -> %s (404 expected)" % code, code == 404, code)
    section("BATCH 0b SERVER RULES")
    for p, to in (("/about.html", "/about"), ("/index.html", "/"),
                  ("/learn/what-is-a-gpu.html", "/learn/what-is-a-gpu"),
                  ("/intelligence/graphics.html", "/intelligence/graphics"),
                  ("/learn/index.html", "/learn/")):
        code, h, _ = fetch(p)
        loc = (h.get("location") or "") if h else ""
        rep("%s -> %s %s" % (p, code, loc), code == 301 and loc.rstrip("/") in
            (to.rstrip("/"), "https://intelreap.com" + to.rstrip("/")) or (to == "/" and code == 301), (code, loc))
    for p in ("/tools/youtube-to-mp3", "/guides/how-to-find-downloads-on-iphone"):
        code = fetch(p)[0]
        rep("%s -> %s (410 expected)" % (p, code), code == 410, code)
    code, h, _ = fetch("/assets/css/ndic-design-system.css")
    cc = (h.get("cache-control") or "") if h else ""
    rep("stylesheet is revalidated on each visit (%s)" % cc, "max-age=0" in cc, cc)
    code, h, _ = fetch("/ads.txt")
    print("INFO  /ads.txt -> %s (404 is expected until Google gives you the line)" % code)
    code, h, _ = fetch("/")
    rep("HSTS header present", bool(h.get("strict-transport-security")))
    rep("nosniff header present", (h.get("x-content-type-options") or "").lower() == "nosniff")
    code, h, _ = fetch("http://intelreap.com/")
    rep("http redirects to https (%s)" % code, code in (301, 308), code)

print("")
print("RESULT: %d passed, %d failed" % (passes, fails))
sys.exit(1 if fails else 0)
PYR1

echo "=================== STATIC CHECKS BEFORE MERGING"
for f in js/*.js assets/js/engines/*.js assets/js/visualizations/*.js \
         assets/js/i18n/i18n-engine.js service-worker.js; do
  node --check "$f" || { echo "ABORT: syntax error in $f"; exit 1; }
done
echo "all scripts parse"
if [ -f "$W/verify0.py" ]; then python3 "$W/verify0.py"; fi
if [ -f "$W/verify0b.py" ]; then python3 "$W/verify0b.py"; fi
if [ -f "$W/verify1.py" ]; then python3 "$W/verify1.py"; fi
if [ -f "$W/verify6b.py" ]; then python3 "$W/verify6b.py"; fi

echo "=================== MERGE INTO main"
git switch main
git pull --ff-only origin main
TAG="pre-release-$BRANCH"
git tag -f "$TAG"
git push -f origin "$TAG"
if git merge-base --is-ancestor main "$BRANCH"; then
  git merge --ff-only "$BRANCH"
else
  git merge --no-ff -m "Merge $BRANCH into main" "$BRANCH" || {
    git merge --abort
    echo "ABORT: merge conflict. main was left untouched."
    git switch "$BRANCH"
    exit 1
  }
fi
git log --oneline -3
git push origin main
MERGED=$(git rev-parse --short HEAD)
echo "main is now at $MERGED"

echo "=================== WAIT FOR NETLIFY TO DEPLOY"
if [ "${NO_WAIT:-0}" != "1" ]; then
  LIVE=0
  for i in $(seq 1 40); do
    if curl -s -m 20 "$SITE$MARK_PATH" | grep -q "$MARK_TEXT"; then
      LIVE=1
      break
    fi
    echo "waiting for the new version... ($i/40)"
    sleep 15
  done
  if [ "$LIVE" != "1" ]; then
    echo "The new version is not live after 10 minutes."
    echo "Open Netlify, check Deploys for errors, then run:"
    echo "  python3 $W/live_check.py $SITE"
    exit 1
  fi
fi
echo "new version is live"

echo "=================== LIVE CHECKS"
set +e
python3 "$W/live_check.py" "$SITE"
RESULT=$?
set -e

echo "=================== AFTER THE RELEASE"
echo "The GitHub Action may add one sitemap commit to main in a minute."
echo "Before any new change run:"
echo "  cd ~/intelreap-frontend && git switch main && git pull --ff-only origin main"
echo "To undo this release (restores the tagged version):"
echo "  git switch main && git push --force-with-lease origin $TAG:main && git reset --hard $TAG"
if [ "$RESULT" != "0" ]; then
  echo "SOME LIVE CHECKS FAILED: paste this output to me."
  exit 1
fi
echo "=========== RELEASE AND LIVE CHECKS DONE"
