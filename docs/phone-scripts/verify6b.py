import json, os, re, subprocess, sys
bad = 0
def rep(name, ok, extra=""):
    global bad
    print(("OK    " if ok else "FAIL  ") + name + (" " + str(extra) if extra else ""))
    if not ok:
        bad += 1
def rd(p):
    return open(p, encoding="utf8").read()
W = os.environ.get("W", "/tmp")
subprocess.run(["node", os.path.join(W, "flat.js")], check=True, stdout=subprocess.DEVNULL)
en = json.load(open(os.path.join(W, "en_flat.json"), encoding="utf8"))
langs = sorted(f[:-3] for f in os.listdir("assets/js/i18n/translations") if f.endswith(".js"))
rep("24 language files", len(langs) == 24, len(langs))
NEW = ["cookie.text", "footer.description", "footer.col_learn", "footer.cookie_settings",
       "footer.free_line", "footer.email_us",
       "contact.email_placeholder", "hero.badge_live", "hero.title_html",
       "hero.tagline", "hero.see_report"]
js = r"""
const fs=require('fs'),vm=require('vm');const d='assets/js/i18n/translations/';
const out={};
for(const f of fs.readdirSync(d).filter(x=>x.endsWith('.js'))){
  const c={window:{}};vm.createContext(c);vm.runInContext(fs.readFileSync(d+f,'utf8'),c);
  const k=Object.keys(c.window).find(x=>x.startsWith('NDIC_TRANSLATIONS_'));
  const flat=(o,p='',r={})=>{for(const a in o){const v=o[a];const q=p?p+'.'+a:a;
    if(v&&typeof v==='object')flat(v,q,r);else r[q]=v}return r};
  out[f.slice(0,-3)]=flat(c.window[k]);
}
console.log(JSON.stringify(out));
"""
data = json.loads(subprocess.run(["node", "-e", js], capture_output=True, text=True, check=True).stdout)
miss = [(l, k) for l in langs for k in NEW if not data[l].get(k)]
rep("all 12 new keys exist in all 24 languages", not miss, miss[:3])
STALE = re.compile(r"no data stored|never (stored|leaves|sent|transmit)|"
                   r"nothing leaves|processes all intelligence locally|"
                   r"locally in your browser", re.I)
stale = [(l, k) for l in langs for k, v in data[l].items()
         if isinstance(v, str) and STALE.search(v) and l == "en"]
rep("no stale privacy claims in English strings", not stale, stale[:3])
rep("English hero tagline is the accurate one",
    data["en"]["hero.tagline"].endswith("Free. No login."))
used = {}
pages = []
for root, _, fs in os.walk("."):
    if ".git" in root.split(os.sep):
        continue
    for f in fs:
        if f.endswith(".html"):
            pages.append(os.path.join(root, f).replace("\\", "/")[2:])
unknown = []
total = 0
per_page = []
for p in sorted(pages):
    s = rd(p)
    keys = re.findall(r'data-i18n(?:-html|-placeholder|-aria|-title)?="([^"]+)"', s)
    total += len(keys)
    per_page.append((p, len(keys)))
    for k in keys:
        if k not in en:
            unknown.append((p, k))
rep("every data-i18n key exists in English", not unknown, unknown[:3])
miss_lang = [(k, l) for p, k in set((p, k) for p in pages
             for k in re.findall(r'data-i18n(?:-html|-placeholder|-aria|-title)?="([^"]+)"', rd(p)))
             for l in langs if not data[l].get(k)]
rep("every used key is translated in all 24 languages", not miss_lang, miss_lang[:3])
no_engine = []
for p in pages:
    s = rd(p)
    if "js/menu-system.js" in s and "i18n-engine.js" not in s:
        no_engine.append(p)
rep("language engine loaded wherever the switcher exists", not no_engine, no_engine[:3])
bad_guard = subprocess.run("grep -l 'window.I18nEngine' js/*.js assets/js/*/*.js || true",
                           shell=True, capture_output=True, text=True).stdout.strip()
rep("no unreachable window.I18nEngine guards", bad_guard == "", bad_guard)
print("      translated elements and attributes in HTML:", total)
for p, n in sorted(per_page, key=lambda x: -x[1])[:6]:
    print("        %-50s %4d" % (p, n))
zero = [p for p, n in per_page if n == 0 and p not in ("410.html", "offline.html", "pinterest-917fa.html")]
print("      pages with no translated text at all:", len(zero))
sys.exit(1 if bad else 0)
