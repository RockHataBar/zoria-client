#!/usr/bin/env bash
unset NVM_DIR; export HOME="/home/$(whoami)"; export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24 >/dev/null
cp /mnt/c/Users/426/Desktop/zoria-client/bot/nakaz.yaml "$HOME/zbot/nakaz.yaml"
cd "$HOME/zbot"
export ZORIA_NPM_AUTH="$(node -p "require('/mnt/c/Users/426/.zoria-registry.json').auth")"
echo "name: $(grep '^name:' nakaz.yaml)"
npm run --silent lint:nakaz
echo "LINT_EXIT=$?"
