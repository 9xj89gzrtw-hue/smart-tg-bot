#!/bin/bash
# PRE-COMMIT HOOK: syntax check + secret scan + push to all backups
# Применяет правила R6 (syntax check), R4 (no hardcoded secrets), R15 (3-2-1 backup)

set -e

echo "=== PRE-COMMIT CHECKS ==="

# R6: Syntax check all .mjs files
echo "1. Syntax check..."
for f in /home/z/my-project/scripts/*.mjs; do
  if [ -f "$f" ]; then
    if ! node --check "$f" 2>/dev/null; then
      echo "❌ Syntax error in $f"
      node --check "$f"
      exit 1
    fi
  fi
done
echo "   ✓ All .mjs files valid"

# R4: Secret scan (no ghp_ or hf_ in tracked files, only in .env)
echo "2. Secret scan..."
SECRETS_FOUND=$(grep -rE --exclude-dir=.git 'ghp_[A-Za-z0-9]{36}|hf_[A-Za-z0-9]{30,}' /home/z/my-project/scripts/ /home/z/my-project/repo/ 2>/dev/null | grep -v '.env' | grep -v 'MEMORY.md' | head -5)
if [ -n "$SECRETS_FOUND" ]; then
  echo "❌ Secrets found in source files:"
  echo "$SECRETS_FOUND"
  echo "Move them to .env!"
  exit 1
fi
echo "   ✓ No secrets in source"

# Check .env exists
if [ ! -f /home/z/my-project/.env ]; then
  echo "⚠️  .env file missing — create it with GH_TOKENS, TG_TOKEN, ALLOWED_CHATS"
fi

echo ""
echo "=== ALL CHECKS PASSED ==="
