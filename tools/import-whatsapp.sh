#!/usr/bin/env bash
# Load a WhatsApp microsite kit (from the batch WhatsApp pipeline) into R2, where the Worker serves it at /wa/.
#
#   unzip iima06-whatsapp-microsite-kit-YYYY-MM-DD.zip
#   tools/import-whatsapp.sh path/to/iima06-whatsapp-microsite-kit --remote     # production bucket
#   tools/import-whatsapp.sh path/to/iima06-whatsapp-microsite-kit --local      # wrangler dev
#
# The kit holds every batchmate's personal data. It goes to R2 only: never commit it, and don't upload
# organiser/ (the preview with everyone's data) or data/pages/ (not used here). Re-running replaces files in place.
set -euo pipefail

KIT="${1:?usage: tools/import-whatsapp.sh <unzipped kit folder> --remote|--local}"
MODE="${2:?say --remote (production) or --local (wrangler dev)}"
case "$MODE" in
  --remote) BUCKET="iima-2006-alumni-media"; CONFIG="wrangler.toml" ;;
  --local)  BUCKET="iima-2006-alumni-local"; CONFIG="wrangler.local.toml" ;;
  *) echo "Second argument must be --remote or --local" >&2; exit 1 ;;
esac
PREFIX="whatsapp-v1"
for need in site/wa/index.html site/wa/story.html data/index.json data/group.json data/people; do
  [ -e "$KIT/$need" ] || { echo "Not a microsite kit: $KIT/$need is missing" >&2; exit 1; }
done

put() {  # put <local file> <key> <content type>
  npx --yes wrangler r2 object put "$BUCKET/$PREFIX/$2" --file "$1" --content-type "$3" --config "$CONFIG" "$MODE" >/dev/null
}
type_of() {
  case "$1" in
    *.html) echo "text/html; charset=utf-8" ;; *.json) echo "application/json" ;; *.js) echo "text/javascript; charset=utf-8" ;;
    *.gif) echo "image/gif" ;; *.png) echo "image/png" ;; *.webp) echo "image/webp" ;; *.svg) echo "image/svg+xml" ;;
    *) echo "application/octet-stream" ;;
  esac
}

people=( "$KIT"/data/people/*.json )
total=$(( ${#people[@]} + 4 ))
n=0; step() { n=$((n+1)); printf '\r%4d / %d  %s' "$n" "$total" "$1" >&2; }

# People first and the index last, so nobody is ever pointed at a file that isn't there yet.
for f in "${people[@]}"; do step "people/$(basename "$f")"; put "$f" "data/people/$(basename "$f")" application/json; done
for f in "$KIT"/site/wa/assets/*; do
  [ -f "$f" ] || continue; total=$((total+1)); step "assets/$(basename "$f")"; put "$f" "site/assets/$(basename "$f")" "$(type_of "$f")"
done
step "group.json";  put "$KIT/data/group.json"      data/group.json  application/json
step "index.html";  put "$KIT/site/wa/index.html"   site/index.html  "text/html; charset=utf-8"
step "story.html";  put "$KIT/site/wa/story.html"   site/story.html  "text/html; charset=utf-8"
step "index.json";  put "$KIT/data/index.json"      data/index.json  application/json
printf '\nLoaded %d files into %s/%s/. Open /wa/ on the site to check.\n' "$n" "$BUCKET" "$PREFIX" >&2
