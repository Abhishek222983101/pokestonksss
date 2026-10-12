default:
    @just --list
test:
    cargo test -p duel-rules --release
fixtures:
    cargo run -p duel-rules --example gen_fixtures --release
balance:
    cargo run -p duel-rules --example balance --release
wasm:
    cd crates/duel-wasm && wasm-pack build --target web --release --out-dir ../../packages/rules-wasm/pkg
build-program:
    anchor build
dev:
    pnpm --filter web dev
deploy:
    @echo "Run yourself (keys never go through the agent): scripts/deploy-devnet.sh"
