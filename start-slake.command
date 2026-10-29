#!/bin/zsh -l
# Double-click this (or point a Stream Deck "Open" button at it) to launch Slake.
# The -l above loads your normal Terminal setup so npm can be found.
cd "$(dirname "$0")" || exit 1

# First run on a new machine: download the app shell.
if [ ! -d node_modules ]; then
  echo "First launch on this machine: installing (takes a minute)..."
  npm install || { echo "Install failed. Scroll up for the error."; read -k 1; exit 1; }
fi

npm start
