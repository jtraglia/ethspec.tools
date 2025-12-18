#!/bin/bash

# Download and prepare Ethereum consensus specs tests
#
# Usage: ./scripts/download.sh <version>
# Example: ./scripts/download.sh v1.6.0

set -e  # Exit on error

# Change to project root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

if [ $# -lt 1 ]; then
  echo "Usage: ./scripts/download.sh <version>"
  echo "Example: ./scripts/download.sh v1.6.0"
  exit 1
fi

# Check for required dependencies
if ! command -v node &> /dev/null; then
  echo "Error: 'node' is not installed."
  echo "Please install Node.js: https://nodejs.org/"
  exit 1
fi

if ! command -v uv &> /dev/null; then
  echo "Error: 'uv' is not installed."
  echo "Please install uv: https://docs.astral.sh/uv/getting-started/installation/"
  exit 1
fi

VERSION=$1
LOGFILE="output_${VERSION}.txt"

# Redirect all output to logfile and terminal
exec > >(tee -a "$LOGFILE") 2>&1

echo "========================================"
echo "Ethereum Consensus Specs Test Downloader"
echo "========================================"
echo ""
echo "Version: $VERSION"
echo "Logfile: $LOGFILE"
echo ""

# Clone consensus-specs repo
REPO_URL="https://github.com/ethereum/consensus-specs.git"
CLONE_DIR="$PROJECT_ROOT/consensus-specs"

# Clean up any existing clone
rm -rf "$CLONE_DIR"

# Special handling for v1.6.0 - use specific commit with ssz-debug-tools changes
if [ "$VERSION" = "v1.6.0" ]; then
  COMMIT="ab09e2e94fb61bc8cf3a24747db0473c2405b2ca"

  echo "Cloning consensus-specs..."
  git clone "$REPO_URL" "$CLONE_DIR"
  cd "$CLONE_DIR"

  echo "Checking out commit $COMMIT..."
  if ! git checkout "$COMMIT"; then
    echo ""
    echo "Error: Failed to checkout commit $COMMIT"
    rm -rf "$CLONE_DIR"
    exit 1
  fi
else
  echo "Cloning consensus-specs at tag $VERSION..."
  if ! git clone --branch "$VERSION" --depth 1 "$REPO_URL" "$CLONE_DIR" 2>/dev/null; then
    echo ""
    echo "Error: Tag '$VERSION' not found."
    echo ""
    # Clone to check available tags
    git clone --bare --filter=blob:none "$REPO_URL" "$CLONE_DIR.bare" 2>/dev/null
    echo "Available tags matching '$VERSION':"
    git -C "$CLONE_DIR.bare" tag -l "*${VERSION}*" | head -20
    echo ""
    echo "Recent tags (last 20):"
    git -C "$CLONE_DIR.bare" tag -l "v*" | grep -E "^v[0-9]+\.[0-9]+\.[0-9]+" | sort -V | tail -20
    rm -rf "$CLONE_DIR.bare"
    exit 1
  fi
  cd "$CLONE_DIR"
fi

# Apply patch to generate pyspec.json
echo "Applying patch..."
git apply "$PROJECT_ROOT/write_pyspec_dict.patch"

# Build pyspec
echo "Building pyspec..."
make _pyspec

# Copy pyspec.json to versioned directory
echo "Copying pyspec.json..."
mkdir -p "$PROJECT_ROOT/pyspec/$VERSION"
cp pyspec.json "$PROJECT_ROOT/pyspec/$VERSION/pyspec.json"

# Return to root directory
cd "$PROJECT_ROOT"

# Run prepare script
echo ""
echo "Running prepare script..."
node scripts/prepare.js "$VERSION"

# Clean up cloned repo
echo ""
echo "Cleaning up..."
rm -rf "$CLONE_DIR"

echo ""
echo "✓ All done!"
echo ""
echo "You can now rebuild the Docker image:"
echo "  docker compose down && docker compose up --build -d"
