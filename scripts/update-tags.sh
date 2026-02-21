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

# Filter to get only stable versions strictly newer than MIN_VERSION
# sort -V places pre-release tags (e.g., v1.6.0-beta.2) after the stable
# release (v1.6.0), so we skip any tag containing a hyphen (pre-release)
# and only include tags that sort after MIN_VERSION.
NEW_TAGS=""
for tag in $ALL_TAGS; do
  # Skip pre-release versions (alpha, beta, rc, etc.)
  if [[ "$tag" == *-* ]]; then
    continue
  fi
  # Skip MIN_VERSION itself and anything that sorts before/equal to it
  if [ "$(printf '%s\n%s' "$MIN_VERSION" "$tag" | sort -V | tail -1)" = "$tag" ] && [ "$tag" != "$MIN_VERSION" ]; then
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
    ((SKIPPED++)) || true
    continue
  fi

  # Check if the release exists (not just the tag)
  # Tags are created immediately, but releases with test assets take ~12 hours to build
  RELEASE_URL="https://api.github.com/repos/ethereum/consensus-specs/releases/tags/$version"
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$RELEASE_URL")

  if [ "$HTTP_STATUS" != "200" ]; then
    log "Skipping $version (release not yet available, tag exists but release returns HTTP $HTTP_STATUS)"
    ((SKIPPED++)) || true
    continue
  fi

  log "Processing $version..."

  if "$SCRIPT_DIR/download.sh" "$version"; then
    log "Successfully processed $version"
    ((PROCESSED++)) || true
  else
    log "ERROR: Failed to process $version"
    ((FAILED++)) || true
  fi
done

log "Complete: $PROCESSED processed, $SKIPPED skipped, $FAILED failed"
