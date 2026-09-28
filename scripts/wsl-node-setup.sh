#!/usr/bin/env bash
set -e
unset NVM_DIR
export HOME="/home/$(whoami)"
cd "$HOME"
export NVM_DIR="$HOME/.nvm"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
fi
. "$NVM_DIR/nvm.sh"
nvm install 24 >/dev/null 2>&1
nvm alias default 24 >/dev/null 2>&1
echo "HOME=$HOME"
echo "node $(node --version)  npm $(npm --version)"
