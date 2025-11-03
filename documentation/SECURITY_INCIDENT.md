# Security Incident Report - ENV Files in Git

## Date: November 2, 2025

## What Happened

`.env.instance_a` and `.env.instance_b` files were accidentally committed and pushed to GitHub in commits:
- `73c9dde` - refactor: Use persistent config files instead of heredocs
- `1c50b3d` - feat: Enhanced position tracking and manual strategy assignment  
- `ac199e3` - fix: Increase default position limit from 100 to 1000

## Exposed Data

**SECRET_KEY Values (Dev Keys):**
- `SECRET_KEY=dev-secret-key-user-a-change-in-production`
- `SECRET_KEY=dev-secret-key-user-b-change-in-production`

**NOT Exposed:**
- ✅ No Schwab API keys
- ✅ No Schwab tokens (schwab_tokens.json was properly gitignored)
- ✅ No Schwab config (schwab_config.toml was properly gitignored)
- ✅ No production secrets
- ✅ No passwords

## Impact Assessment

**Severity: Medium**
- Keys were labeled "dev" and "change-in-production"
- No actual production secrets or API credentials exposed
- Local development keys only

**Risk:**
- Someone could use these keys to forge JWT tokens for dev instances
- No impact on production (not deployed yet)
- No Schwab account access possible

## Remediation Completed

1. ✅ Removed `.env.instance_a` and `.env.instance_b` from git tracking
2. ✅ Added to `.gitignore`
3. ✅ Created `.template` files instead
4. ✅ Committed fix (commit `7d4fc59`)

## Still Required

**Force push to remove from GitHub history:**
```bash
git push --force-with-lease origin main
```

**WARNING:** This rewrites history. Anyone who has pulled recently will need to:
```bash
git fetch origin
git reset --hard origin/main
```

## Recommendations

1. **Change all SECRET_KEY values** in local `.env.instance_*` files
2. **Never commit `.env` files** - always use `.template` or `.example`
3. **Use different keys** for each environment (dev/staging/prod)
4. **Production keys** should be managed via:
   - Environment variables
   - Secret management service (AWS Secrets Manager, etc.)
   - Never in code or config files

## Files Now Properly Gitignored

```
.env
.env.local
.env.instance_a
.env.instance_b
schwab_tokens.json
schwab.token_file.json
```

## Setup Instructions (Going Forward)

1. Copy template files:
   ```bash
   cp backend/.env.instance_a.template backend/.env.instance_a
   cp backend/.env.instance_b.template backend/.env.instance_b
   ```

2. Generate new secret keys:
   ```bash
   openssl rand -hex 32
   ```

3. Update SECRET_KEY in both files with unique values

4. These files will never be committed (gitignored)

