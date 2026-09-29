#!/usr/bin/env bash
set -e
unset NVM_DIR; export HOME="/home/$(whoami)"; export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24 >/dev/null
SRC="/mnt/c/Users/426/Desktop/zoria-client"
cp "$SRC"/bot/src/*.ts "$HOME/zbot/src/"
cp "$SRC"/scripts/diag.mjs "$HOME/zbot/diag.mjs"
cd "$HOME/zbot"
npm run --silent build
DIAG_AT="${DIAG_AT:-}" node diag.mjs "$@"
