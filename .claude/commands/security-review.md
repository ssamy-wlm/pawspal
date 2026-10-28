---
description: Review changes against docs/security.md
---
Use the `security-reviewer` subagent to review the current diff (`git diff` plus staged changes) against `docs/security.md`. List every finding with file, line, risk and fix. Fix all high and medium findings, then run `bash scripts/test-db.sh` again.
