#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CLI="$ROOT/dist/cli.js"
OUT_DIR="$ROOT/tmp/smoke"

needs_build=0
if [[ ! -f "$CLI" ]]; then
  needs_build=1
elif find "$ROOT/src" -type f -name '*.ts' -newer "$CLI" -print -quit | read -r _; then
  needs_build=1
fi

if [[ "$needs_build" -eq 1 ]]; then
  npm run build
fi

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

convert_and_validate() {
  local name="$1"
  local mode="$2"
  local input="$ROOT/examples/$name.md"
  local output="$OUT_DIR/$name.toon"

  node "$CLI" convert "$input" --mode "$mode" --out "$output" --stats > "$OUT_DIR/$name.convert.log"
  test -s "$output"
  node "$CLI" validate "$output" > "$OUT_DIR/$name.validate.log"
}

convert_and_validate prose lossless
convert_and_validate definitions record
convert_and_validate requirements record
convert_and_validate table lossless

node "$CLI" decode "$OUT_DIR/definitions.toon" --out "$OUT_DIR/definitions.json" > "$OUT_DIR/definitions.decode.log"
grep -q '"defs"' "$OUT_DIR/definitions.json"
grep -q '"Canonical JSON"' "$OUT_DIR/definitions.json"

node "$CLI" convert "$ROOT/examples/plain.txt" \
  --mode lossless \
  --out "$OUT_DIR/plain.toon" \
  > "$OUT_DIR/plain.convert.log"
test -s "$OUT_DIR/plain.toon"
node "$CLI" validate "$OUT_DIR/plain.toon" > "$OUT_DIR/plain.validate.log"

printf '# Pasted\n\nDefinition: Stdin conversion keeps pasted text in the same validation path.\n' \
  | node "$CLI" convert \
      --stdin \
      --type md \
      --mode lossless \
      --out "$OUT_DIR/stdin.toon" \
      > "$OUT_DIR/stdin.convert.log"
test -s "$OUT_DIR/stdin.toon"
node "$CLI" validate "$OUT_DIR/stdin.toon" > "$OUT_DIR/stdin.validate.log"

set +e
node "$CLI" convert "$ROOT/examples/prose.md" \
  --mode budget \
  --target-chars 10 \
  --out "$OUT_DIR/budget-refusal.toon" \
  > "$OUT_DIR/budget-refusal.stdout" \
  2> "$OUT_DIR/budget-refusal.stderr"
budget_status=$?
set -e

if [[ "$budget_status" -eq 0 ]]; then
  echo "Expected budget conversion to refuse an impossible lossless target." >&2
  exit 1
fi

if [[ -e "$OUT_DIR/budget-refusal.toon" ]]; then
  echo "Budget refusal unexpectedly wrote TOON output." >&2
  exit 1
fi

grep -q "Target cannot be reached losslessly" "$OUT_DIR/budget-refusal.stderr"

node "$CLI" convert "$ROOT/examples/prose.md" \
  --mode budget \
  --target-chars 1000 \
  --allow-lossy \
  --out "$OUT_DIR/budget-lossy.toon" \
  > "$OUT_DIR/budget-lossy.convert.log"
test -s "$OUT_DIR/budget-lossy.toon"
node "$CLI" validate "$OUT_DIR/budget-lossy.toon" > "$OUT_DIR/budget-lossy.validate.log"
grep -q "lossless: false" "$OUT_DIR/budget-lossy.convert.log"

node "$CLI" profile "$ROOT/fixtures/agent-context/problematic/mixed-agent-context.md" \
  > "$OUT_DIR/mixed-agent-profile.log"
grep -q "optimizer warnings:" "$OUT_DIR/mixed-agent-profile.log"
grep -q "Possible duplicate rule" "$OUT_DIR/mixed-agent-profile.log"
grep -q "Possibly vague instruction" "$OUT_DIR/mixed-agent-profile.log"
grep -q "Long section" "$OUT_DIR/mixed-agent-profile.log"
grep -q "Possible split candidate" "$OUT_DIR/mixed-agent-profile.log"

echo "Smoke passed. Generated outputs are in tmp/smoke."
