#!/bin/bash
# Starts anvil and makes it ready to cook: the released v12 stack at its release addresses and a Pot
# for anvil's first account (scripts/deploy.ts), recorded in .deployment.json for `pnpm sync-price`
# and `pnpm stop`.
#
#   pnpm start:local [--chain-id <id>] [--port <port>] [--zero-fee]
#   pnpm start:fork <rpc-url> [--port <port>] [--zero-fee]   (start-fork.sh)
#
# A fork keeps the forked chain's id. Without one the node takes --chain-id, Base's 8453 by default:
# the `sauce` command reads names and refuses an endpoint by its chain id, so a node it should run
# on has to be a chain it knows. The fork URL is an argument, never read from the environment.
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

FORK_URL=""
CHAIN_ID="8453"
PORT="8545"
DEPLOY_FLAGS=()
while [ $# -gt 0 ]; do
    case "$1" in
        --fork) FORK_URL="$2"; shift 2 ;;
        --chain-id) CHAIN_ID="$2"; shift 2 ;;
        --port) PORT="$2"; shift 2 ;;
        --zero-fee) DEPLOY_FLAGS+=("--zero-fee"); shift ;;
        *) echo "Unknown argument: $1"; exit 1 ;;
    esac
done
RPC_URL="http://127.0.0.1:$PORT"

if ! command -v anvil > /dev/null; then
    echo "anvil not found: install Foundry (https://getfoundry.sh)"
    exit 1
fi

if lsof -i :"$PORT" > /dev/null 2>&1; then
    echo "Port $PORT is already in use. Killing existing process..."
    lsof -ti :"$PORT" | xargs kill -9 2>/dev/null || true
    sleep 1
fi

cd "$REPO_ROOT"
if [ -n "$FORK_URL" ]; then
    echo -e "${YELLOW}Starting anvil, forking the chain behind the given RPC...${NC}"
    anvil --port "$PORT" --fork-url "$FORK_URL" > "$REPO_ROOT/.anvil.log" 2>&1 &
else
    echo -e "${YELLOW}Starting anvil (chain id $CHAIN_ID)...${NC}"
    anvil --port "$PORT" --chain-id "$CHAIN_ID" --gas-limit 100000000 > "$REPO_ROOT/.anvil.log" 2>&1 &
fi
NODE_PID=$!

for i in {1..60}; do
    if cast chain-id --rpc-url "$RPC_URL" > /dev/null 2>&1; then
        break
    fi
    if ! kill -0 $NODE_PID 2>/dev/null; then
        echo "anvil exited. Check .anvil.log for details."
        cat "$REPO_ROOT/.anvil.log"
        exit 1
    fi
    sleep 1
done
if ! cast chain-id --rpc-url "$RPC_URL" > /dev/null 2>&1; then
    echo "anvil failed to respond. Check .anvil.log for details."
    kill $NODE_PID 2>/dev/null
    exit 1
fi
echo -e "${GREEN}anvil running (PID: $NODE_PID)${NC}"

echo -e "${YELLOW}Setting up Sauce...${NC}"
if ! DEPLOY_OUTPUT=$(npx tsx scripts/deploy.ts "$RPC_URL" "${DEPLOY_FLAGS[@]}"); then
    kill $NODE_PID 2>/dev/null
    exit 1
fi
DEPLOYMENT=$(echo "$DEPLOY_OUTPUT" | grep "^SAUCE_DEPLOYMENT=" | cut -d'=' -f2-)
if [ -z "$DEPLOYMENT" ]; then
    echo "Setting up Sauce failed:"
    echo "$DEPLOY_OUTPUT"
    kill $NODE_PID 2>/dev/null
    exit 1
fi

# .deployment.json: the stack, plus what `stop` and `sync-price` need. The fork URL is kept out of
# the printed output, since it may carry a key.
node -e '
  const [deployment, pid, forkUrl] = process.argv.slice(1);
  const out = { ...JSON.parse(deployment), nodePid: Number(pid) };
  if (forkUrl) out.forkUrl = forkUrl;
  require("fs").writeFileSync(".deployment.json", JSON.stringify(out, null, 2) + "\n");
' "$DEPLOYMENT" "$NODE_PID" "$FORK_URL"

field() { node -e 'console.log(require("./.deployment.json")[process.argv[1]])' "$1"; }

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}       Ready!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "${CYAN}RPC:${NC}       $RPC_URL (chain id $(field chainId))"
echo -e "${CYAN}Stack:${NC}     $(field stack) — engine $(field engine), Kitchen $(field kitchen)"
echo -e "${CYAN}Fee:${NC}       $(field executionFee) wei per cook"
echo -e "${CYAN}Owner:${NC}     $(field owner) (anvil account 0)"
echo -e "${CYAN}Pot:${NC}       $(field pot)"
echo ""
echo -e "Run a program:  ${YELLOW}sauce run <file.sauce.ts> --chain $(field chainId) --rpc-url $RPC_URL --private-key <anvil key 0>${NC}"
echo -e "Stop with:      ${YELLOW}pnpm stop${NC}"
