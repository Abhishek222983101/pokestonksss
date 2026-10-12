#!/usr/bin/env bash
# USER-RUN. Deletes and recreates the GitHub repo with the current (clean-author) history so stale
# contributor/commit caches disappear. Refuses to run if any commit is not authored by the noreply identity.
set -euo pipefail
cd "$(dirname "$0")/.."
OWNER=Abhishek222983101; REPO=pokestonksss
GOOD="141759667+$OWNER@users.noreply.github.com"
BAD=$(git log --format='%ae%n%ce' | sort -u | grep -v "^$GOOD$" || true)
[ -z "$BAD" ] || { echo "Refusing: commits with other identities: $BAD"; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo "Commit or stash local changes first."; exit 1; }
echo "All $(git rev-list --count HEAD) commits are authored by $GOOD."
read -r -p "Delete github.com/$OWNER/$REPO and recreate it? [y/N] " a; [ "$a" = y ] || exit 0
gh repo delete "$OWNER/$REPO" --yes
gh repo create "$OWNER/$REPO" --public --description "PokeStonksss — PokeStonks rebuilt on Solana + MagicBlock Ephemeral Rollups (VRF, oracle, commit)"
git remote set-url origin "https://github.com/$OWNER/$REPO.git" 2>/dev/null || git remote add origin "https://github.com/$OWNER/$REPO.git"
git push -u origin main
echo "Done: https://github.com/$OWNER/$REPO"
