#!/usr/bin/env bash
# Run every thirdparty/ plugin test suite in bounded, network-less containers.
# Node suites use the built-in runner (no install). Python suites use unittest
# with the standard library only. The sources are copied inside the container,
# so tests can never write into the checkout.
set -Eeuo pipefail
cd "$(dirname "$0")/../.."
NODE_IMAGE=${THIRDPARTY_NODE_IMAGE:-node:22-alpine}
PY_IMAGE=${THIRDPARTY_PYTHON_IMAGE:-python:3.12-alpine}
LIMITS=(--rm --network none --memory=1g --cpus=2)
FAILED=0
for dir in thirdparty/*/; do
  name=$(basename "$dir")
  if [[ -f "$dir/package.json" ]] || compgen -G "$dir*.test.mjs" >/dev/null || [[ -d "$dir/test" && -n "$(ls "$dir"/test/*.test.js 2>/dev/null)" ]]; then
    echo "--- $name (node --test)"
    if ! docker run "${LIMITS[@]}" -v "$PWD/$dir:/src:ro" "$NODE_IMAGE" sh -c \
        'cp -r /src /work && cd /work && files=$(find . -path ./node_modules -prune -o \( -name "*.test.js" -o -name "*.test.mjs" \) -print | sort) && node --test $files'; then
      FAILED=1
    fi
  fi
  if compgen -G "$dir/tests/test_*.py" >/dev/null; then
    echo "--- $name (python unittest)"
    if ! docker run "${LIMITS[@]}" -v "$PWD/$dir:/src:ro" "$PY_IMAGE" sh -c \
        'cp -r /src /work && cd /work && python -m unittest discover -s tests -v'; then
      FAILED=1
    fi
  fi
done
if (( FAILED )); then
  echo 'Tests failed: PCP.Jenkins/thirdparty — a plugin suite failed; see above.' >&2
  exit 1
fi
echo 'Tests passed: PCP.Jenkins/thirdparty — all plugin suites passed.'
