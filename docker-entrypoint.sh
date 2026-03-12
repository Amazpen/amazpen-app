#!/bin/sh

# Load .env file if it exists (created by Dokploy when createEnvFile=true)
if [ -f .env ]; then
  echo "[entrypoint] Loading .env file..."
  set -a
  . ./.env
  set +a
fi

# Execute the main command
exec "$@"
