#!/bin/bash

# Update nightly pyspec from consensus-specs master branch
#
# This script:
# - Checks for new commits on ethereum/consensus-specs master
# - If changed, builds pyspec and updates pyspec/nightly/pyspec.json
#
# Designed to run via cron (e.g., every 15 minutes or hourly)

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

REPO_URL="https://github.com/ethereum/consensus-specs.git"
SHA_FILE="$PROJECT_ROOT/.nightly-sha"
LOGFILE="$PROJECT_ROOT/update-nightly.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOGFILE"
}

log "Checking for new commits on consensus-specs master..."

# Get the latest commit SHA from remote
LATEST_SHA=$(git ls-remote "$REPO_URL" refs/heads/master | cut -f1)

if [ -z "$LATEST_SHA" ]; then
  log "ERROR: Failed to fetch latest SHA from remote"
  exit 1
fi

# Get the last known SHA
LAST_SHA=""
if [ -f "$SHA_FILE" ]; then
  LAST_SHA=$(cat "$SHA_FILE")
fi

# Check if there's a new commit
if [ "$LATEST_SHA" = "$LAST_SHA" ]; then
  log "No changes (SHA: ${LATEST_SHA:0:7})"
  exit 0
fi

log "New commit detected: ${LATEST_SHA:0:7} (was: ${LAST_SHA:-none})"
log "Building nightly pyspec..."

# Create temp directory for build
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Clone consensus-specs (shallow)
log "Cloning consensus-specs..."
git clone --depth 1 "$REPO_URL" "$TEMP_DIR/consensus-specs"

# Apply patch
log "Applying patch..."
cd "$TEMP_DIR/consensus-specs"
git apply "$PROJECT_ROOT/write_pyspec_dict.patch"

# Build pyspec
log "Running make _pyspec..."
make _pyspec

# Copy result
log "Copying pyspec.json..."
mkdir -p "$PROJECT_ROOT/pyspec/nightly"
cp pyspec.json "$PROJECT_ROOT/pyspec/nightly/pyspec.json"

# Update SHA file
echo "$LATEST_SHA" > "$SHA_FILE"

log "Nightly update complete"
