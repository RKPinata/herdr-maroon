#!/usr/bin/env bash
# Writes Linear's GraphQL SDL to .cache/linear-schema.graphql.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .cache
gh api repos/linear/linear/contents/packages/sdk/src/schema.graphql \
  -H "Accept: application/vnd.github.raw" > .cache/linear-schema.graphql
echo "schema: $(wc -c < .cache/linear-schema.graphql) bytes"
