#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOYMENT_FILE="$REPO_ROOT/.deployment.json"

# Try to get PID from deployment file
if [ -f "$DEPLOYMENT_FILE" ]; then
    HARDHAT_PID=$(grep -o '"hardhatPid":[0-9]*' "$DEPLOYMENT_FILE" | grep -o '[0-9]*')
fi

# Also check if anything is running on port 8545
PORT_PID=$(lsof -ti :8545 2>/dev/null)

if [ -n "$HARDHAT_PID" ] && kill -0 "$HARDHAT_PID" 2>/dev/null; then
    echo -e "${YELLOW}Stopping Hardhat (PID: $HARDHAT_PID)...${NC}"
    kill "$HARDHAT_PID"
    echo -e "${GREEN}Hardhat stopped.${NC}"
elif [ -n "$PORT_PID" ]; then
    echo -e "${YELLOW}Stopping process on port 8545 (PID: $PORT_PID)...${NC}"
    kill "$PORT_PID"
    echo -e "${GREEN}Process stopped.${NC}"
else
    echo -e "${YELLOW}No Hardhat process found running.${NC}"
fi

# Clean up files
if [ -f "$DEPLOYMENT_FILE" ]; then
    rm "$DEPLOYMENT_FILE"
    echo "Removed .deployment.json"
fi

if [ -f "$REPO_ROOT/.hardhat.log" ]; then
    rm "$REPO_ROOT/.hardhat.log"
    echo "Removed .hardhat.log"
fi
