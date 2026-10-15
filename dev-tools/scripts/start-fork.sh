#!/bin/bash
# Forks the chain behind <rpc-url> on anvil and makes it ready to cook. See start-local.sh.
#
#   pnpm start:fork <rpc-url> [--port <port>] [--zero-fee]
set -e

if [ -z "$1" ] || [[ "$1" == --* ]]; then
    echo "Usage: pnpm start:fork <rpc-url> [--port <port>] [--zero-fee]"
    echo "Example: pnpm start:fork <rpc-url>   (an RPC of the chain to fork, such as Base)"
    exit 1
fi

FORK_URL="$1"
shift
exec "$(dirname "$0")/start-local.sh" --fork "$FORK_URL" "$@"
