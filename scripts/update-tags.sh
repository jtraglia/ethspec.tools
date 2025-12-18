#!/bin/bash

# Update tagged releases from consensus-specs
#
# This script:
# - Checks for new version tags on ethereum/consensus-specs
# - Downloads and processes any new versions via download.sh
#
# Designed to run via cron (e.g., hourly)

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

REPO_URL="https://github.com/ethereum/consensus-specs.git"
MIN_VERSION="v1.6.0"
LOGFILE="$PROJECT_ROOT/update-tags.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOGFILE"
}

log "Checking for new consensus-specs tags..."

# Create temp directory for git operations
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Clone just the tags (shallow bare clone)
git clone --bare --filter=blob:none "$REPO_URL" "$TEMP_DIR/repo" 2>/dev/null
cd "$TEMP_DIR/repo"

# Get all version tags (v*.*.*)
ALL_TAGS=$(git tag -l "v*.*.*" | sort -V)

# Filter to get only versions newer than MIN_VERSION
NEW_TAGS=""
FOUND_MIN=false
for tag in $ALL_TAGS; do
  if [ "$tag" = "$MIN_VERSION" ]; then
    FOUND_MIN=true
    continue
  fi
  if [ "$FOUND_MIN" = true ]; then
    NEW_TAGS="$NEW_TAGS $tag"
  fi
done

cd "$PROJECT_ROOT"

if [ -z "$NEW_TAGS" ]; then
  log "No versions found newer than $MIN_VERSION"
  exit 0
fi

log "Found versions newer than $MIN_VERSION:$NEW_TAGS"

# Process each new version
PROCESSED=0
SKIPPED=0
FAILED=0

for version in $NEW_TAGS; do
  # Check if already downloaded (pyspec directory exists)
  if [ -d "pyspec/$version" ]; then
    log "Skipping $version (already exists)"
    ((SKIPPED++))
    continue
  fi

  log "Processing $version..."

  if ./scripts/download.sh "$version"; then
    log "Successfully processed $version"
    ((PROCESSED++))
  else
    log "ERROR: Failed to process $version"
    ((FAILED++))
  fi
done

log "Complete: $PROCESSED processed, $SKIPPED skipped, $FAILED failed"
