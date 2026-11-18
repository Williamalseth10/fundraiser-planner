#!/bin/bash
# Build the volunteer download package for one committed revision, from a clean export of that commit.
#   scripts/package.sh [revision] [output folder]     (defaults: HEAD, ./package-out)
# Produces fundraiser-planner-<rev>.zip with: the app as one HTML file, START HERE guide,
# a short README and the full source at that revision. Run the tests separately first.
set -euo pipefail
REV=$(git rev-parse --short "${1:-HEAD}")
OUT=$(mkdir -p "${2:-package-out}" && cd "${2:-package-out}" && pwd)
WORK=$(mktemp -d)
P="$WORK/fundraiser-planner-$REV"
mkdir -p "$P/source"
git archive "$REV" | tar -x -C "$P/source"
(cd "$P/source" && node scripts/build.js >/dev/null)
cp "$P/source/dist/booster-fundraiser-planner.html" "$P/Fundraiser Planner.html"
cmp -s "$P/Fundraiser Planner.html" "$P/source/index.html" || { echo "index.html at $REV is not the build of src/" >&2; exit 1; }
rm -rf "$P/source/dist"
cp "$P/source/docs/START_HERE.md" "$P/START HERE.md"
cat > "$P/README.txt" <<EOF
Fundraiser Planner (revision $REV)

FOR THE VOLUNTEER
  1. Read "START HERE.md" (opens in any text viewer).
  2. Double-click "Fundraiser Planner.html". It opens in your web browser. No internet or account needed.
  3. Choose a fundraiser format and start your plan, or open a backup you already have.
  Your plan is saved only in that browser on that computer. Use Save & backup -> Download backup file to keep a copy.

FOR DEVELOPERS
  source/            the full project at this revision (code, tests, docs, CI)
  source/README.md   architecture, build and test instructions, financial rules

EOF
(cd "$WORK" && zip -qr "$OUT/fundraiser-planner-$REV.zip" "fundraiser-planner-$REV")
echo "$OUT/fundraiser-planner-$REV.zip"
