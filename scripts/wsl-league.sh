#!/usr/bin/env bash
set -e
unset NVM_DIR; export HOME="/home/$(whoami)"; export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24 >/dev/null
SRC="/mnt/c/Users/426/Desktop/zoria-client"
cp "$SRC"/bot/src/*.ts "$HOME/zbot/src/"
cp "$SRC"/scripts/bench.mjs "$HOME/zbot/bench.mjs"
cd "$HOME/zbot"
npm run --silent build
SEEDS="${2:-6}"
FIRST="${3:-2026}"
for PRESET in ${1//,/ }; do
  for R in "обхідник,рівний" "проривник,облягач" "^r1,^r1:swarm" "^r1:swarm,^r1:swarm" "^r1,^old"; do
    node bench.mjs "$R" "$SEEDS" "$PRESET" - "$FIRST" &
  done
  wait
done
