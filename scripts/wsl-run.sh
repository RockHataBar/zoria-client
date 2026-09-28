#!/usr/bin/env bash
set -e
unset NVM_DIR
export HOME="/home/$(whoami)"
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm use 24 >/dev/null

SRC="/mnt/c/Users/426/Desktop/zoria-client/bot"
DST="$HOME/zbot"
REG="/mnt/c/Users/426/.zoria-registry.json"

mkdir -p "$DST/src"
cp "$SRC"/src/*.ts "$DST/src/"
cp "$SRC/package.json" "$SRC/tsconfig.json" "$SRC/nakaz.yaml" "$SRC/.npmrc" "$DST/"
[ -f "$SRC/README.md" ] && cp "$SRC/README.md" "$DST/"

export ZORIA_NPM_AUTH="$(node -p "require('$REG').auth")"
cd "$DST"
if [ ! -d node_modules ] || [ "$SRC/package.json" -nt node_modules ]; then
  npm install --no-audit --no-fund >/tmp/zbot-install.log 2>&1 || { tail -5 /tmp/zbot-install.log; exit 1; }
fi

if [ "$#" -eq 0 ]; then
  exec npm run play -- --fast --out records
else
  exec "$@"
fi
