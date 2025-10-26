# Schwab API Setup Guide

This guide walks you through setting up Schwab API access for the Portfolio Planner application.

## Prerequisites

- A Schwab brokerage account
- Python 3.11+ installed
- Backend dependencies installed (`pip install -r requirements.txt`)

## Step 1: Register for Schwab API Access

1. Go to [Schwab Developer Portal](https://developer.schwab.com/)
2. Log in with your Schwab account credentials
3. Navigate to **"My Apps"** or **"Register an App"**
4. Create a new application:
   - **App Name**: Portfolio Planner (or any name you prefer)
   - **Redirect URI**: `https://127.0.0.1:8182`
   - **Description**: Personal portfolio tracking application
   
5. After registration, you'll receive:
   - **App Key** (also called Consumer Key or Client ID)
   - **App Secret** (also called Client Secret)
   
   ⚠️ **IMPORTANT**: Save these credentials securely! You won't be able to see the secret again.

## Step 2: Configure Your Local Environment

### 2.1 Create Configuration File

```bash
cd backend
cp schwab_config.toml.template schwab_config.toml
```

### 2.2 Edit Configuration

Open `backend/schwab_config.toml` and fill in your credentials:

```toml
# Your Schwab API credentials from developer.schwab.com
consumer_key = "YOUR_APP_KEY_FROM_STEP1"
app_secret = "YOUR_APP_SECRET_FROM_STEP1"

# OAuth callback URL (must match what you registered)
callback_url = "https://127.0.0.1:8182"

# Path to store the OAuth token file
token_path = "schwab_tokens.json"

# Optional: Specify a default account (last 4 digits) to sync
# Leave empty to sync all accounts
account_number = ""

# Optional: API timeout settings (in seconds)
api_timeout = 120
connect_timeout = 30
```

## Step 3: Generate Your Authentication Token

Run the token generation script:

```bash
cd backend
python get_schwab_token.py
```

### What happens:

1. ✅ Script validates your configuration
2. 🌐 Opens your browser to Schwab's login page
3. 🔐 You log in to Schwab and authorize the app
4. 🔗 You'll be redirected to a localhost URL (it will show an error page - that's OK!)
5. 📋 Copy the **entire redirected URL** from your browser
6. ✏️ Paste it back into the terminal
7. 💾 Script saves your tokens to `schwab_tokens.json`

### Example:

```
🔐 Starting Schwab OAuth authentication...
   A browser window will open for you to log in to Schwab
   After logging in, you'll be redirected to a URL
   Copy that ENTIRE URL and paste it back here

[Browser opens, you log in]

Paste the URL here: https://127.0.0.1:8182/?code=ABC123...&state=XYZ789...

✅ Testing connection...

🎉 SUCCESS! Connected to Schwab API
   Found 2 account(s):
   - Account ending in 1234
   - Account ending in 5678

💾 Token saved to: /path/to/schwab_tokens.json

✅ You're all set! The token will auto-refresh for the next 7 days.
```

## Step 4: Verify Connection

### Option A: Test via Backend API

Start the backend server:

```bash
cd backend
source venv/bin/activate  # or: venv\Scripts\activate on Windows
uvicorn app.main:app --reload
```

Visit the API docs at http://localhost:8000/docs and try the Schwab endpoints.

### Option B: Test the Full Application

Use the startup script:

```bash
./start.sh
```

Then navigate to http://localhost:3000 and go to **Schwab Positions** from the menu.

## Security Best Practices

### ✅ DO:
- Keep `schwab_config.toml` local and never commit it to git
- Keep `schwab_tokens.json` local and never commit it to git
- Store backups of your config file in a secure password manager
- Use the API regularly to keep tokens fresh (at least once every 7 days)

### ❌ DON'T:
- Never share your App Key or App Secret with anyone
- Never commit configuration files to version control
- Never paste tokens or secrets in chat, email, or public forums
- Don't store credentials in plain text files outside this directory

## Token Management

### Token Lifecycle

- **Access Token**: Lasts 30 minutes, auto-refreshes
- **Refresh Token**: Lasts 7 days from creation
- **Auto-refresh**: Happens automatically when you use the API

### Token Expiration

If your refresh token expires (after 7 days of inactivity), you'll need to re-authenticate:

```bash
cd backend
python get_schwab_token.py
```

### Checking Token Status

The backend will automatically handle token refresh. If there are issues, check `backend.log` for details.

## Troubleshooting

### "Consumer key not set" Error

**Problem**: Configuration file not properly set up  
**Solution**: Make sure you copied the template and filled in your actual credentials

### "Token file not found" Error

**Problem**: You haven't run the token generation script yet  
**Solution**: Run `python get_schwab_token.py`

### "Failed to connect" After Login

**Problem**: Redirect URI mismatch  
**Solution**: 
1. Check that your callback URL in `schwab_config.toml` matches what you registered with Schwab
2. Default should be `https://127.0.0.1:8182` (note: HTTPS, not HTTP)

### "Unauthorized" or "Invalid Token" Errors

**Problem**: Token has expired (>7 days old)  
**Solution**: Re-run `python get_schwab_token.py` to get fresh tokens

### Browser Shows "Connection Not Secure"

**Problem**: The redirect uses HTTPS on localhost  
**Solution**: This is **normal and expected**! Click "Advanced" → "Proceed anyway" to continue. Just copy the full URL from the address bar.

### "schwab-py library not installed"

**Problem**: Missing dependency  
**Solution**: 
```bash
cd backend
source venv/bin/activate
pip install schwab-py
```

## Multi-Account Setup

If you have multiple Schwab accounts:

1. All accounts linked to your Schwab login will be accessible
2. Leave `account_number` empty in the config to see all accounts
3. Use the frontend account selector to choose which accounts to sync

## Files Reference

| File | Purpose | Commit to Git? |
|------|---------|----------------|
| `schwab_config.toml.template` | Template for configuration | ✅ Yes |
| `schwab_config.toml` | Your actual credentials | ❌ **NEVER** |
| `schwab_tokens.json` | OAuth tokens | ❌ **NEVER** |
| `get_schwab_token.py` | Token generation script | ✅ Yes |

## Need Help?

- **Schwab API Documentation**: https://developer.schwab.com/products/trader-api--individual/details/documentation
- **schwab-py Library**: https://github.com/alexgolec/schwab-py
- **Portfolio Planner Issues**: Check the project documentation folder

## Next Steps

After successfully connecting to Schwab:

1. ✅ Configure which accounts to sync in Settings
2. ✅ Run your first sync to import positions
3. ✅ Explore the Schwab Positions view
4. ✅ Add notes and tags to your positions
5. ✅ Share trade ideas with friends

Happy trading! 📈

