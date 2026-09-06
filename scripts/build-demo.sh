#!/usr/bin/env bash
# Assemble the recorded scenes into one demo video at the script's timings.
#
# Each scene is retimed to the duration its voiceover needs, rather than
# whatever the recording happened to take — so the narration lines up without
# hand-editing. Scene 3 is the reason this exists: a ~90s run compressed into
# a 34s slot.
#
# Usage: bash scripts/build-demo.sh [rawDir] [outFile]
set -euo pipefail

RAW="${1:-demo-raw}"
OUT="${2:-groundtruth-demo.mp4}"
W=1920; H=1080; FPS=30

command -v ffmpeg >/dev/null || { echo "ffmpeg not found"; exit 1; }
[ -d "$RAW" ] || { echo "no such directory: $RAW — run record-demo.mjs first"; exit 1; }

# scene:target_seconds:mode — targets come from the voiceover word counts.
#   speed = retime the whole clip (a 130s run becomes a 34s time-lapse)
#   tail  = keep only the last N seconds (the run-up is not worth showing)
SCENES=(
  "scene1-problem:23:speed"
  "scene2-understanding:22:speed"
  "scene3-live-run:34:speed"
  "scene4-evidence:22:tail"
  "scene5a-verdict:10:tail"
  "scene5b-honest-no:10:tail"
  "scene6-real-call:21:speed"
  "scene7-goal-gate:16:speed"
)

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
LIST="$TMP/list.txt"; : > "$LIST"

echo "retiming scenes to the voiceover budget"
VF_COMMON="scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=#09090b,fps=${FPS}"

for entry in "${SCENES[@]}"; do
  IFS=":" read -r name target mode <<< "$entry"
  src="$RAW/$name.webm"
  if [ ! -f "$src" ]; then echo "  ! missing $name.webm — skipping"; continue; fi

  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$src")

  if [ "$mode" = "tail" ]; then
    printf "  %-24s %6.1fs -> %ss  (last %ss)\n" "$name" "$dur" "$target" "$target"
    ffmpeg -nostdin -loglevel error -y -sseof "-${target}" -i "$src" \
      -vf "$VF_COMMON" -an -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
      "$TMP/$name.mp4"
  else
    # setpts scales playback: <1 speeds up, >1 slows down.
    pts=$(awk -v t="$target" -v d="$dur" 'BEGIN{printf "%.6f", t/d}')
    printf "  %-24s %6.1fs -> %ss  (%.2fx)\n" "$name" "$dur" "$target" \
      "$(awk -v p="$pts" 'BEGIN{printf "%.2f", 1/p}')"
    ffmpeg -nostdin -loglevel error -y -i "$src" \
      -vf "setpts=${pts}*PTS,${VF_COMMON}" \
      -an -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
      "$TMP/$name.mp4"
  fi
  echo "file '$TMP/$name.mp4'" >> "$LIST"
done

echo "concatenating"
ffmpeg -nostdin -loglevel error -y -f concat -safe 0 -i "$LIST" \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -r "$FPS" "$OUT"

TOTAL=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")
printf "\n%s — %.1fs (%d:%02d)\n" "$OUT" "$TOTAL" \
  "$(awk -v t="$TOTAL" 'BEGIN{print int(t/60)}')" \
  "$(awk -v t="$TOTAL" 'BEGIN{print int(t%60)}')"
awk -v t="$TOTAL" 'BEGIN{ if (t>180) print "OVER the 3:00 limit — trim a scene"; else printf "under the 3:00 limit, %.0fs to spare\n", 180-t }'

cat <<EOF

Next:
  1. Record your voiceover over $OUT (381 words, ~2:40).
  2. Mux it in:
     ffmpeg -i $OUT -i voiceover.m4a -c:v copy -c:a aac -shortest final.mp4
  3. Upload to YouTube — public, not unlisted.
     Thumbnail: docs/brand/youtube-thumbnail.png
EOF
