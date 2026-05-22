#!/bin/bash
# Ralph Loop — Cancel Script
# Removes Ralph loop state files to stop an active loop.

set -euo pipefail

LOOP_STATE=".pi/ralph-loop.json"
RESULT_STATE=".pi/ralph-result.json"

if [ -f "$LOOP_STATE" ]; then
  ITERATION=$(python3 -c "import json; print(json.load(open('$LOOP_STATE')).get('iteration', '?'))" 2>/dev/null || echo "?")
  rm "$LOOP_STATE"
  echo "🛑 Cancelled Ralph loop (was at iteration $ITERATION)"
else
  echo "⚠️  No active Ralph loop found."
fi

rm -f "$RESULT_STATE"
