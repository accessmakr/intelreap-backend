# Phone scripts (frontend release tooling)

Copies of the two scripts the owner runs in Termux on their phone, saved here because they existed nowhere else. **These are copies; the working versions live on the phone** at `~/release.sh` and `~/work-tmp/live_check.py`. If you change one, update the other place too.

- `release.sh <branch> <live-file-path> <text-that-appears-when-live>`: guard (clean tree, branch pushed), static checks, tag `pre-release-<branch>`, merge into frontend `main`, push, wait for Netlify to serve the marker text, then run the live check. The undo command is printed at the end.
- `live_check.py [site]`: live checks (assets, sitemap pages, titles, canonicals, hubs, legal pages, 410/301/404 rules, headers). `release.sh` rewrites `~/work-tmp/live_check.py` from its embedded copy on every run, so **edit the copy inside `release.sh`**, then regenerate this file with `awk "/<<'PYR1'/{f=1;next} /^PYR1\$/{f=0} f" release.sh > live_check.py`.

Known problems (see `../HANDOFF.md`): the check "sitemap lists 35 URLs" is hard-coded (the sitemap has grown); the title check fails on titles over 60 characters (two keyword-mapped articles exceed it, by design); the static check stage also runs `~/work-tmp/verify0.py`, `verify0b.py`, `verify1.py` and `verify6b.py` if they exist, and **those four files are not saved anywhere** (one of them hard-codes service worker version 1.7.0); `scripts/content/base.html` blocks the redirect check. Intended fix: make title length and sitemap count warnings.
