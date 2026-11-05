# Phone scripts (frontend release tooling)

**This folder is the master copy.** The phone runs copies of these files. After any change here, reinstall on the phone with the one-liner at the bottom.

- `release.sh <branch> <live-file-path> <text-that-appears-when-live>`: guard (clean tree, branch pushed), static checks, tag `pre-release-<branch>`, merge into frontend `main`, push, wait for Netlify to serve the marker text, then run the live check. The undo command is printed at the end.
- `live_check.py [site]`: live checks (assets, sitemap pages, canonicals, hubs, legal pages, 410/301/404 rules, headers). Installed to `~/work-tmp/live_check.py`; `release.sh` no longer carries its own copy.
- `verify0.py`, `verify0b.py`, `verify1.py`, `verify6b.py`: static checks run by `release.sh` from `~/work-tmp/` (design tokens and navigation; redirects, canonicals and links; asset references; translations).

Rules for the checks (owner's instruction): **no hard-coded counts and no rules about article titles.** The sitemap is checked for being non-empty and free of duplicates, never for a fixed number. Article titles belong to the content owner and are only checked for existing. The service worker is checked for having a version, not for a specific one.

Not saved anywhere: `~/work-tmp/flat.js`, which `verify6b.py` runs to flatten the English translations (paste it if you want it saved).

## Install or update on the phone (one line, no login needed)
```
mkdir -p ~/work-tmp && B=https://raw.githubusercontent.com/accessmakr/intelreap-backend/main/docs/phone-scripts && curl -fsSL $B/release.sh -o ~/release.sh && for f in live_check.py verify0.py verify0b.py verify1.py verify6b.py; do curl -fsSL $B/$f -o ~/work-tmp/$f; done && echo "scripts installed"
```
