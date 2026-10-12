#!/usr/bin/env bash
# USER-RUN (keys never go through the agent).
# Builds and deploys/upgrades one program on devnet with the deployer keypair.
# Usage: scripts/deploy-devnet.sh <crate-name>     e.g. er-vrf | pokestonksss
set -euo pipefail
NAME="${1:?crate name, e.g. er-vrf or pokestonksss}"
SNAKE="${NAME//-/_}"
KP="${DEPLOYER_KEYPAIR:-$HOME/.config/solana/blitz-deployer.json}"
[ -f "$KP" ] || KP="$HOME/.config/solana/pokestonksss-deployer.json"
RPC="${DEPLOY_RPC:-https://rpc.magicblock.app/devnet}"
cd "$(dirname "$0")/.."
[ -f "$KP" ] || { echo "Missing $KP — run ~/bin/blitz-key-finish.sh, or fund the helper wallet"; exit 1; }
echo "Deployer: $(solana address -k "$KP")  balance: $(solana balance -k "$KP" -u "$RPC")"
anchor build -p "$NAME"
SO="target/deploy/$SNAKE.so"; PID="target/deploy/$SNAKE-keypair.json"
echo "Binary: $(du -h "$SO" | cut -f1)  program id: $(solana address -k "$PID")"
# upgrades fail if the new binary outgrew the program account: extend it with headroom first (no-op on first deploy)
PID_ADDR="$(solana address -k "$PID")"
if solana program show "$PID_ADDR" --url "$RPC" >/dev/null 2>&1; then
  CUR=$(solana program show "$PID_ADDR" --url "$RPC" | awk '/Data Length/ {print $3}')
  NEW=$(stat -c %s "$SO")
  if [ "${NEW:-0}" -gt "${CUR:-0}" ]; then solana program extend "$PID_ADDR" 20480 --keypair "$KP" --url "$RPC" || true; fi
fi
solana program deploy "$SO" --program-id "$PID" --keypair "$KP" --url "$RPC" --use-rpc
echo "DONE. Program: $(solana address -k "$PID")"
solana program show "$(solana address -k "$PID")" --url "$RPC" | head -8
