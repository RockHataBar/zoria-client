#!/usr/bin/env bash
set -e
unset NVM_DIR; export HOME="/home/$(whoami)"; export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24 >/dev/null
cd "$HOME/zbot"
export ZORIA_NPM_AUTH="$(node -p "require('/mnt/c/Users/426/.zoria-registry.json').auth")"
echo "=== lint:nakaz ==="; npm run --silent lint:nakaz && echo "LINT-EXIT=$?" || echo "LINT-EXIT=$?"
echo "=== latest pack dir ==="; PACK="$(ls -dt records/pack-* | head -1)"; echo "$PACK"; ls -la "$PACK" | head -20
echo "=== pack.json top ==="; node -e "const p=require('$HOME/zbot/'+process.argv[1]+'/pack.json'); console.log(JSON.stringify({keys:Object.keys(p), games:(p.games||p.matches||[]).length, sample:p.games?p.games[0]:p}, null, 1).slice(0,900))" "$PACK"
echo "=== belief files ==="; find "$PACK" -name 'belief*'.ndjson -o -name '*belief*' | head; B="$(find records -name 'belief*.ndjson' | head -1)"; [ -n "$B" ] && { echo "first belief: $B ($(wc -l < "$B") lines)"; head -1 "$B"; } || echo "no belief files (ZARIA_BELIEF не заданий у play)"
