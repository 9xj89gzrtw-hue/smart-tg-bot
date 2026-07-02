#!/bin/bash
# Integrity check — verifies all memory files exist and are valid
set -e

echo "=== INTEGRITY CHECK ==="
FILES=(
  "SELF_IMPROVEMENT.md"
  "MEMORY.md"
  "CRITICAL_RULES.md"
  "CHANGELOG.md"
  "TEMPLATES.md"
  "META_PROMPT_QUICK_REF.md"
  "TECHNICAL_DISCOVERIES.md"
  "FAILED_ATTEMPTS.md"
  "CONVERSATION_LOG.md"
)

ALL_OK=true
for f in "${FILES[@]}"; do
  if [ -f "/home/z/my-project/$f" ]; then
    LINES=$(wc -l < "/home/z/my-project/$f")
    echo "  ✓ $f ($LINES lines)"
  else
    echo "  ✗ $f MISSING"
    ALL_OK=false
  fi
done

# Check bot syntax
for f in /home/z/my-project/scripts/*.mjs; do
  if node --check "$f" 2>/dev/null; then
    echo "  ✓ $(basename $f) syntax OK"
  else
    echo "  ✗ $(basename $f) SYNTAX ERROR"
    ALL_OK=false
  fi
done

# Check .env
if [ -f "/home/z/my-project/.env" ]; then
  echo "  ✓ .env exists"
else
  echo "  ✗ .env MISSING"
  ALL_OK=false
fi

if $ALL_OK; then
  echo ""
  echo "✅ ALL CHECKS PASSED"
  exit 0
else
  echo ""
  echo "❌ SOME CHECKS FAILED"
  exit 1
fi
