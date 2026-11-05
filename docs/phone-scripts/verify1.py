import os, re, json, sys
missing = []
checked = 0
def exists(base_dir, ref):
    ref = ref.split('#')[0].split('?')[0]
    if not ref:
        return True
    if ref.startswith('/'):
        t = '.' + ref
    else:
        t = os.path.normpath(os.path.join(base_dir, ref))
    if t.endswith("/"):
        t += "index.html"
    return (os.path.exists(t) or os.path.exists(t + ".html")
            or os.path.exists(os.path.join(t, "index.html")))
NOT_SITE = ('scripts', 'docs', 'node_modules')  # working files, not site pages
def skip(root):
    parts = root.split(os.sep)
    return '.git' in parts or (len(parts) > 1 and parts[1] in NOT_SITE)
for root, _, files in os.walk('.'):
    if skip(root):
        continue
    for f in files:
        if not f.endswith('.html'):
            continue
        p = os.path.join(root, f)
        s = open(p, encoding='utf8', errors='ignore').read()
        refs = re.findall(r'<script[^>]*\ssrc="([^"]+)"', s)
        refs += re.findall(r'<link[^>]*\shref="([^"]+)"', s)
        refs += re.findall(r'<img[^>]*\ssrc="([^"]+)"', s)
        for r in refs:
            if r.startswith(('http', '//', 'data:', 'mailto:', '#')):
                continue
            checked += 1
            if not exists(root, r):
                missing.append((p, r))
m = json.load(open('manifest.json', encoding='utf8'))
srcs = [i['src'] for i in m.get('icons', [])]
for sc in m.get('shortcuts', []):
    srcs += [i['src'] for i in sc.get('icons', [])]
for sc in m.get('screenshots', []):
    srcs.append(sc['src'])
for r in srcs:
    checked += 1
    if not exists('.', r):
        missing.append(('manifest.json', r))
sw = open('service-worker.js', encoding='utf8').read()
for block in re.findall(r'const PRECACHE_(?:STATIC|PAGES) = \[(.*?)\]', sw, re.S):
    for r in re.findall(r"'(/[^']*)'", block):
        checked += 1
        if not exists('.', r):
            missing.append(('service-worker.js', r))
for root, _, files in os.walk('.'):
    if skip(root):
        continue
    for f in files:
        if f.endswith(('.html', '.js')):
            p = os.path.join(root, f)
            s = open(p, encoding='utf8', errors='ignore').read()
            for r in re.findall(r'https://intelreap\.com(/assets/[^"\'\s)]+)', s):
                checked += 1
                if not exists('.', r):
                    missing.append((p, r))
            if f == 'registry.js':
                for r in re.findall(r"logo:\s*'(/[^']+)'", s):
                    checked += 1
                    if not exists('.', r):
                        missing.append((p, r))
print("references checked:", checked)
print("MISSING:", len(missing))
for p, r in missing[:40]:
    print("  ", p, "->", r)
sys.exit(1 if missing else 0)
