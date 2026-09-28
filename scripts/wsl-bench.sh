#!/usr/bin/env bash
set -e
unset NVM_DIR; export HOME="/home/$(whoami)"; export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24 >/dev/null
SRC="/mnt/c/Users/426/Desktop/zoria-client"
cp "$SRC"/bot/src/*.ts "$HOME/zbot/src/"
cp "$SRC"/scripts/bench.mjs "$HOME/zbot/bench.mjs"
cd "$HOME/zbot"
export ZORIA_NPM_AUTH="$(node -p "require('/mnt/c/Users/426/.zoria-registry.json').auth")"
npm run --silent build
node bench.mjs "$1" "$2"
