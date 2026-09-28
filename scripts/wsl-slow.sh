#!/usr/bin/env bash
set -e
unset NVM_DIR; export HOME="/home/$(whoami)"; export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24 >/dev/null
cd "$HOME/zbot"
export ZORIA_NPM_AUTH="$(node -p "require('/mnt/c/Users/426/.zoria-registry.json').auth")"
npm run --silent build
npx zaria-kit pack --ticks 40 --out records-slow 2>&1
echo "=== grep наказ вів (пусто = P2-04 ok) ==="
grep -R "вів наказ" records-slow 2>/dev/null || echo "NONE"
