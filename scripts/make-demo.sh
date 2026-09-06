#!/usr/bin/env bash
# Record the whole demo video, start to finish, in one command.
#
#   bash scripts/make-demo.sh
#
# Produces a silent MP4 under 3:00, ready for you to add voiceover.
# Starts its own app instance on a spare port and stops it afterwards, so it
# doesn't matter whether you already have a dev server running.
#
# Options (env):
#   OUT=my-demo.mp4      output file        (default groundtruth-demo.mp4)
#   PORT=3210            port for the app   (default 3210)
#   KEEP=1               keep the raw scene files for retakes
#   BASE=https://...     record a deployed URL instead of a local build
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="${OUT:-groundtruth-demo.mp4}"
PORT="${PORT:-3210}"
RAW="${RAW:-.demo-raw}"
LOG="$(mktemp)"
SERVER_PID=""

cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  [ "${KEEP:-0}" = "1" ] || rm -rf "$RAW"
  rm -f "$LOG"
}
trap cleanup EXIT

step() { printf "\n\033[1;32m▸\033[0m %s\n" "$1"; }

command -v ffmpeg >/dev/null || { echo "ffmpeg is required: brew install ffmpeg"; exit 1; }
command -v node   >/dev/null || { echo "node is required"; exit 1; }

# --- 1. the app -------------------------------------------------------------
if [ -n "${BASE:-}" ]; then
  step "Recording the deployed app at $BASE"
else
  BASE="http://localhost:${PORT}"

  step "Building the app"
  pnpm build >"$LOG" 2>&1 || { echo "build failed:"; tail -20 "$LOG"; exit 1; }

  step "Starting the app on port $PORT (demo mode, no credentials)"
  # DATABASE_URL is deliberately cleared: the demo must be deterministic and
  # must not depend on a network round-trip per tick.
  env -u DATABASE_URL MOCK_CALL_E=true PORT="$PORT" pnpm start >"$LOG" 2>&1 &
  SERVER_PID=$!

  for i in $(seq 1 90); do
    curl -sf "$BASE/api/settings" >/dev/null 2>&1 && break
    sleep 0.5
    [ "$i" = 90 ] && { echo "app did not start:"; tail -20 "$LOG"; exit 1; }
  done

  MODE=$(curl -s "$BASE/api/settings")
  case "$MODE" in
    *'"demoMode":true'*) : ;;
    *) echo "refusing to record: app is not in demo mode -> $MODE"; exit 1 ;;
  esac
fi

# --- 2. record --------------------------------------------------------------
step "Recording scenes (about 8 minutes — two full verification runs)"
node scripts/record-demo.mjs "$BASE" "$RAW"

MISSING=0
for s in scene1-problem scene2-understanding scene3-live-run scene4-evidence \
         scene5a-verdict scene5b-honest-no scene6-real-call scene7-goal-gate; do
  [ -f "$RAW/$s.webm" ] || { echo "  ! $s.webm missing"; MISSING=1; }
done
[ "$MISSING" = 1 ] && echo "  (the build will skip missing scenes — rerun to retake)"

# --- 3. assemble ------------------------------------------------------------
step "Assembling $OUT"
bash scripts/build-demo.sh "$RAW" "$OUT"

# --- 4. verify --------------------------------------------------------------
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")
printf "\n"
awk -v t="$DUR" -v f="$OUT" 'BEGIN{
  printf "%s — %d:%02d\n", f, int(t/60), int(t%60);
  if (t > 180) { printf "\033[1;31mOVER the 3:00 limit by %.0fs\033[0m — trim a scene in build-demo.sh\n", t-180; exit 1 }
  else printf "\033[1;32mUnder the 3:00 limit, %.0fs to spare.\033[0m\n", 180-t
}'

cat <<EOF

Silent video is ready. Add your voiceover in any editor, or from the CLI:
  ffmpeg -i $OUT -i voiceover.m4a -c:v copy -c:a aac -shortest final.mp4

Upload to YouTube as PUBLIC (not unlisted) — the rules require it.
Thumbnail: docs/brand/youtube-thumbnail.png
EOF
