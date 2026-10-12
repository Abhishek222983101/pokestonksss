#!/usr/bin/env bash
# USER-RUN (keys never go through the agent).
# Builds and deploys/upgrades one program on devnet with the deployer keypair.
# Usage: scripts/deploy-devnet.sh <crate-name>     e.g. er-vrf | pokestonksss
set -euo pipefail
NAME="${1:?crate name, e.g. er-vrf or pokestonksss}"
SNAKE="${NAME//-/_}"
KP="${DEPLOYER_KEYPAIR:-$HOME/.config/solana/blitz-deployer.json}"
RPC="${DEPLOY_RPC:-https://rpc.magicblock.app/devnet}"
cd "$(dirname "$0")/.."
[ -f "$KP" ] || { echo "Missing $KP — run: ~/bin/blitz-key-finish.sh"; exit 1; }
echo "Deployer: $(solana address -k "$KP")  balance: $(solana balance -k "$KP" -u "$RPC")"
anchor build -p "$NAME"
SO="target/deploy/$SNAKE.so"; PID="target/deploy/$SNAKE-keypair.json"
echo "Binary: $(du -h "$SO" | cut -f1)  program id: $(solana address -k "$PID")"
solana program deploy "$SO" --program-id "$PID" --keypair "$KP" --url "$RPC" --use-rpc
echo "DONE. Program: $(solana address -k "$PID")"
solana program show "$(solana address -k "$PID")" --url "$RPC" | head -8
