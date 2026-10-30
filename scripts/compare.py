import json, sys, time, urllib.request

UA = ("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
      "Chrome/130.0.0.0 Mobile Safari/537.36")
HEAD = {"Origin": "https://intelreap.com", "User-Agent": UA, "Accept": "*/*",
        "Accept-Language": "en-US", "Referer": "https://intelreap.com/"}
V = "https://intelreap-backend.vercel.app"
C = "https://intelreap-backend.accessmakr.workers.dev"


def say(*a):
    print(*a)
    sys.stdout.flush()


def get(base, path):
    last = None
    for attempt in (1, 2):
        t0 = time.time()
        say("  asking", base.split("//")[1].split(".")[0], path, "(try %d)" % attempt)
        try:
            r = urllib.request.urlopen(
                urllib.request.Request(base + path, headers=HEAD), timeout=35)
            j = json.loads(r.read().decode())
            say("  answered in %.1fs" % (time.time() - t0))
            return j.get("data", j)
        except Exception as e:
            last = str(e)
            say("  failed after %.1fs: %s" % (time.time() - t0, last))
    return {"_error": last}


for path in ("/api/ip-identity", "/api/ip-deep"):
    say("=====", path)
    v = get(V, path)
    c = get(C, path)
    if "_error" in v:
        say("Vercel did not answer:", v["_error"])
    if "_error" in c:
        say("Cloudflare did not answer:", c["_error"])
    if "_error" in v or "_error" in c:
        continue
    skip = {"fetchedAt", "responseTime", "fromCache", "strategyUsed",
            "dataSource", "source", "strategyErrors"}
    same = 0
    for k in sorted(set(v) | set(c)):
        if k in skip:
            continue
        a, b = v.get(k, "<missing>"), c.get(k, "<missing>")
        if a != b:
            say("%-26s vercel=%r | cloudflare=%r" % (k, a, b))
        else:
            same += 1
    say("fields identical:", same)
    say("data source: vercel=%s cloudflare=%s" % (
        v.get("source") or v.get("dataSource"),
        c.get("source") or c.get("dataSource")))
say("DONE")
