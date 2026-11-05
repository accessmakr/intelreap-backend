import json
import os
import re
import sys
import tomllib

bad = 0
ROOT5 = ("about", "contact", "privacy-policy", "cookies-policy", "terms-of-use")
UTILITY = {"410.html", "offline.html", "pinterest-917fa.html", "404.html"}
# folders that are working files, not site pages
NOT_SITE = ("scripts", "docs", "node_modules")

def rep(name, ok, extra=""):
    global bad
    print(("OK    " if ok else "FAIL  ") + name + (" " + str(extra) if extra else ""))
    if not ok:
        bad += 1
def rd(p): return open(p, encoding="utf8").read()

pages = []
for root, _, fs in os.walk("."):
    parts = root.split(os.sep)
    if ".git" in parts or any(p in NOT_SITE for p in parts[1:2]):
        continue
    for f in fs:
        if f.endswith(".html"):
            pages.append(os.path.join(root, f).replace("\\", "/")[2:])
pages.sort()

css = rd("assets/css/ndic-design-system.css")
rep("body no longer clips with a scroll container", re.search(
    r"body \{[^}]*overflow-x: clip", css) is not None)

nt = tomllib.loads(rd("netlify.toml"))
fors = [h["for"] for h in nt["headers"]]
rep("no year-long cache on all of /assets", "/assets/*" not in fors)
for want in ("/assets/css/*", "/assets/js/*", "/js/*"):
    v = [h for h in nt["headers"] if h["for"] == want]
    rep("fresh-check cache header on " + want,
        bool(v) and "max-age=0" in v[0]["values"]["Cache-Control"])
red = nt["redirects"]
froms = {r["from"] for r in red}
want = {"/" + p for p in pages if p not in UTILITY}
absent = sorted(want - froms)
rep("redirect from every .html page to its clean address (%d)" % len(want),
    not absent, absent[:3])
for p in ("/tools/*", "/guides/how-to-find-downloads-on-iphone"):
    rep("old page returns 410: " + p, p in froms)

bad_canon = []
for p in pages:
    if p in UTILITY:
        continue
    c = re.search(r'<link rel="canonical" href="([^"]+)"', rd(p))
    if not c or c.group(1).endswith(".html"):
        bad_canon.append(p)
rep("every canonical is a clean address", not bad_canon, bad_canon[:3])

left = []
pat = re.compile(r"(%s)\.html" % "|".join(ROOT5))
for root, _, fs in os.walk("."):
    parts = root.split(os.sep)
    if ".git" in parts or "translations" in root or any(p in NOT_SITE for p in parts[1:2]):
        continue
    for f in fs:
        if f.endswith((".html", ".js", ".xml")) and f != "pages.json":
            p = os.path.join(root, f).replace("\\", "/")
            if f == "sitemap.xml":
                continue
            text = rd(p)
            if f.endswith(".html"):
                text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
            if pat.search(text):
                left.append(p)
rep("no links to the five pages use .html", not left, left[:4])

sa = [p for p in pages if "SearchAction" in rd(p)] + (
    ["js/schema.js"] if "SearchAction'" in rd("js/schema.js") else [])
rep("no search template in structured data", not sa, sa[:3])

sw = rd("service-worker.js")
rep("service worker has a version", re.search(r"intelreap-v\d+\.\d+\.\d+", sw) is not None)
rep("code files are fetched network first",
    "networkFirst(request, CACHES.static)" in sw)
rep("no .html page entries left in the precache list",
    not re.search(r"'/[a-z/-]+\.html'", re.search(
        r"PRECACHE_PAGES = \[(.*?)\]", sw, re.S).group(1).replace("'/offline.html'", "")))

known = set()
for p in pages:
    known.add(p)
    known.add(p[:-5])
    if p.endswith("index.html"):
        known.add(p[:-10])
missing = []
for p in pages:
    s = rd(p)
    base = os.path.dirname(p)
    for h in re.findall(r'<a [^>]*href="([^"#?]+)', s):
        if h.startswith(("http", "mailto:", "tel:", "javascript:", "//")):
            continue
        if h.startswith("/"):
            t = h[1:]
        else:
            t = os.path.normpath(os.path.join(base, h)).replace("\\", "/")
        t = t.lstrip("./")
        if t in ("", ".") or t in known or os.path.exists(t) or t.rstrip("/") in known:
            continue
        missing.append((p, h))
rep("every internal link points at a real page", not missing, missing[:3])
sys.exit(1 if bad else 0)
