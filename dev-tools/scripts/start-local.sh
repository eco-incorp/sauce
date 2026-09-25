#!/bin/bash
set -e

# Get the repo root directory
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Check for Sauce artifact
if [ ! -f "$REPO_ROOT/artifacts/ISauceRouter.json" ]; then
    echo "Error: artifacts/ISauceRouter.json not found."
    echo "Run './engine/export-artifact.sh' from the repo root to generate it."
    exit 1
fi

echo -e "${YELLOW}Starting Hardhat local network...${NC}"

# Check if something is already running on port 8545
if lsof -i :8545 > /dev/null 2>&1; then
    echo "Port 8545 is already in use. Killing existing process..."
    lsof -ti :8545 | xargs kill -9 2>/dev/null || true
    sleep 1
fi

# Start hardhat node in the background
cd "$REPO_ROOT"

# Support forking via FORK_URL environment variable
if [ -n "$FORK_URL" ]; then
    echo -e "${CYAN}Forking from: $FORK_URL${NC}"
    npx hardhat node --fork "$FORK_URL" > "$REPO_ROOT/.hardhat.log" 2>&1 &
else
    npx hardhat node > "$REPO_ROOT/.hardhat.log" 2>&1 &
fi
HARDHAT_PID=$!

# Wait for hardhat to be ready
echo "Waiting for Hardhat to start..."
for i in {1..30}; do
    if curl -s -X POST -H 'Content-Type: application/json' \
        --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
        http://127.0.0.1:8545 > /dev/null 2>&1; then
        break
    fi
    if ! kill -0 $HARDHAT_PID 2>/dev/null; then
        echo "Failed to start Hardhat. Check .hardhat.log for details."
        exit 1
    fi
    sleep 1
done

# Final check
if ! curl -s -X POST -H 'Content-Type: application/json' \
    --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
    http://127.0.0.1:8545 > /dev/null 2>&1; then
    echo "Hardhat failed to respond. Check .hardhat.log for details."
    kill $HARDHAT_PID 2>/dev/null
    exit 1
fi

echo -e "${GREEN}Hardhat running (PID: $HARDHAT_PID)${NC}"
echo ""

# Deploy Sauce contract
echo -e "${YELLOW}Deploying Sauce contract...${NC}"
DEPLOY_OUTPUT=$(npx tsx scripts/deploy.ts 2>&1)

# Extract the Sauce address from the output
SAUCE_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep "SAUCE_ADDRESS=" | cut -d'=' -f2)

if [ -z "$SAUCE_ADDRESS" ]; then
    echo "Failed to deploy Sauce contract:"
    echo "$DEPLOY_OUTPUT"
    kill $HARDHAT_PID 2>/dev/null
    exit 1
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}       Deployment complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${CYAN}Sauce Address:${NC} $SAUCE_ADDRESS"
echo ""
echo -e "Hardhat PID:    $HARDHAT_PID"
echo -e "RPC URL:        http://127.0.0.1:8545"
echo -e "Chain ID:       31337"
echo ""
echo -e "To stop:        ${YELLOW}npm run stop${NC}"

# Write deployment info to a file for other scripts to use
if [ -n "$FORK_URL" ]; then
cat > "$REPO_ROOT/.deployment.json" << EOF
{
  "sauceAddress": "$SAUCE_ADDRESS",
  "rpcUrl": "http://127.0.0.1:8545",
  "forkUrl": "$FORK_URL",
  "hardhatPid": $HARDHAT_PID
}
EOF
else
cat > "$REPO_ROOT/.deployment.json" << EOF
{
  "sauceAddress": "$SAUCE_ADDRESS",
  "rpcUrl": "http://127.0.0.1:8545",
  "hardhatPid": $HARDHAT_PID
}
EOF
fi

echo ""
echo -e "Deployment info saved to ${CYAN}.deployment.json${NC}"
