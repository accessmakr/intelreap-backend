import collections
import glob
import json
import os
import re
import subprocess
import sys

bad = 0
def rep(name, ok, extra=""):
    global bad
    print(("OK    " if ok else "FAIL  ") + name + (" " + str(extra) if extra else ""))
    if not ok:
        bad += 1
def rd(p): return open(p, encoding="utf8").read()

css = rd("assets/css/ndic-design-system.css")
self_ref = re.findall(r"(--[a-z0-9-]+)\s*:\s*var\(\s*\1\s*\)", css)
rep("no self-referencing colour tokens", not self_ref, self_ref[:3])
blocks = re.findall(r"(?:\[data-theme=\"dark\"\]|:root:not\(\[data-theme\]\)) \{(.*?)\n\s*\}", css, re.S)
rep("dark blocks define the header and overlay colours",
    len(blocks) >= 2 and all("--color-header-bg:" in b and "rgba(5,6,10" in b for b in blocks))
defs = set()
uses = collections.defaultdict(set)
def scan(text, src):
    for m in re.finditer(r"(--[a-z0-9-]+)\s*:", text):
        defs.add(m.group(1))
    for m in re.finditer(r"var\(\s*(--[a-z0-9-]+)\s*(,)?", text):
        if not m.group(2):
            uses[m.group(1)].add(src)
for f in glob.glob("assets/css/*.css"):
    scan(rd(f), f)
for f in glob.glob("**/*.html", recursive=True):
    s = rd(f)
    for st in re.findall(r"<style[^>]*>(.*?)</style>", s, re.S):
        scan(st, f)
    for st in re.findall(r'style="([^"]*)"', s):
        scan(st, f)
und = sorted(k for k in uses if k not in defs)
rep("every custom property in use is defined", not und, und[:4])

ms = rd("js/menu-system.js")
rep("drawer opens with both class names",
    "ndic-mobile-drawer--open" in ms and ms.count("ndic-mobile-drawer--open") == 2)
rg = rd("js/registry.js")
rep("Learn and Guides are in the navigation",
    "id: 'learn'" in rg and "id: 'guides'" in rg and "navKey: 'nav.guides'" in rg)
for f in ("js/menu-system.js", "js/registry.js", "service-worker.js"):
    r = subprocess.run(["node", "--check", f], capture_output=True)
    rep("syntax " + f, r.returncode == 0)
js = r"""
const fs=require('fs'),vm=require('vm');const d='assets/js/i18n/translations/';
let n=0,miss=[];
for(const f of fs.readdirSync(d).filter(x=>x.endsWith('.js'))){
  const c={window:{}};vm.createContext(c);vm.runInContext(fs.readFileSync(d+f,'utf8'),c);
  const k=Object.keys(c.window).find(x=>x.startsWith('NDIC_TRANSLATIONS_'));
  n++; if(!(c.window[k].nav||{}).guides) miss.push(f);
}
console.log(JSON.stringify({n,miss}));
"""
out = json.loads(subprocess.run(["node", "-e", js], capture_output=True, text=True).stdout)
rep("nav.guides exists in all 24 languages", out["n"] == 24 and not out["miss"], out)
# Article titles belong to the content owner: only check that every article has one.
empty = []
for d in ("learn", "guides"):
    for f in glob.glob(d + "/*.html"):
        m = re.search(r"<title>(.*?)</title>", rd(f), re.S)
        if not m or not m.group(1).strip():
            empty.append(f)
rep("every article has a title", not empty, empty[:3])
sys.exit(1 if bad else 0)
