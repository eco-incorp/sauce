#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOYMENT_FILE="$REPO_ROOT/.deployment.json"

# Try to get PID from deployment file
if [ -f "$DEPLOYMENT_FILE" ]; then
    NODE_PID=$(grep -o '"nodePid": *[0-9]*' "$DEPLOYMENT_FILE" | grep -o '[0-9]*$')
fi

# Also check if anything is running on port 8545
PORT_PID=$(lsof -ti :8545 2>/dev/null)

if [ -n "$NODE_PID" ] && kill -0 "$NODE_PID" 2>/dev/null; then
    echo -e "${YELLOW}Stopping anvil (PID: $NODE_PID)...${NC}"
    kill "$NODE_PID"
    echo -e "${GREEN}anvil stopped.${NC}"
elif [ -n "$PORT_PID" ]; then
    echo -e "${YELLOW}Stopping process on port 8545 (PID: $PORT_PID)...${NC}"
    kill "$PORT_PID"
    echo -e "${GREEN}Process stopped.${NC}"
else
    echo -e "${YELLOW}No anvil process found running.${NC}"
fi

# Clean up files
if [ -f "$DEPLOYMENT_FILE" ]; then
    rm "$DEPLOYMENT_FILE"
    echo "Removed .deployment.json"
fi

if [ -f "$REPO_ROOT/.anvil.log" ]; then
    rm "$REPO_ROOT/.anvil.log"
    echo "Removed .anvil.log"
fi
