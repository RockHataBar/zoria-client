#!/usr/bin/env bash
set -e
unset NVM_DIR; export HOME="/home/$(whoami)"; export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24 >/dev/null
SRC="/mnt/c/Users/426/Desktop/zoria-client"
REV="${1:-HEAD}"
NAME="${2:-old}"
DIR="$HOME/zbot/$NAME"
rm -rf "$DIR"
mkdir -p "$DIR/src"
git -C "$SRC" show "$REV:bot/src/strategy.ts" > "$DIR/src/strategy.ts"
cat > "$DIR/tsconfig.json" <<'EOF'
{
  "extends": "../tsconfig.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src", "sourceMap": false },
  "include": ["src"]
}
EOF
cd "$HOME/zbot"
npx tsc -p "$DIR/tsconfig.json"
echo "$NAME <- $REV"
