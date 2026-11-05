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

if [ ! -f "$W/live_check.py" ]; then
  echo "ABORT: $W/live_check.py is missing. Install the scripts from the repo (docs/phone-scripts/README.md)."
  exit 1
fi

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
