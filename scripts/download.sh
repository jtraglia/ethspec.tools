#!/bin/bash
source "$HOME/.local/bin/env"

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

# Update pyspec/versions.json
echo "Updating pyspec/versions.json..."
node -e "
const fs = require('fs');
const versionsPath = '$PROJECT_ROOT/pyspec/versions.json';
let versions = [];
if (fs.existsSync(versionsPath)) {
  versions = JSON.parse(fs.readFileSync(versionsPath, 'utf8'));
}
const newVersion = '$VERSION';
if (!versions.includes(newVersion)) {
  versions.push(newVersion);
}
// Sort versions: nightly first, then semver descending (release > beta > alpha)
versions.sort((a, b) => {
  if (a === 'nightly') return -1;
  if (b === 'nightly') return 1;
  // Parse version strings
  const parseVersion = (v) => {
    const match = v.match(/^v(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta)\.(\d+))?$/);
    if (!match) return null;
    return {
      major: parseInt(match[1]),
      minor: parseInt(match[2]),
      patch: parseInt(match[3]),
      preType: match[4] || 'release',
      preNum: match[5] ? parseInt(match[5]) : 0
    };
  };
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return a.localeCompare(b);
  // Compare major.minor.patch descending
  if (pa.major !== pb.major) return pb.major - pa.major;
  if (pa.minor !== pb.minor) return pb.minor - pa.minor;
  if (pa.patch !== pb.patch) return pb.patch - pa.patch;
  // Same base version: release > beta > alpha
  const typeOrder = { release: 0, beta: 1, alpha: 2 };
  if (pa.preType !== pb.preType) return typeOrder[pa.preType] - typeOrder[pb.preType];
  // Same pre-release type: higher number first
  return pb.preNum - pa.preNum;
});
fs.writeFileSync(versionsPath, JSON.stringify(versions, null, 2) + '\n');
console.log('Updated pyspec/versions.json');
"

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
