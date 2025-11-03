#!/usr/bin/env python3
"""
Schwab Token Setup Utility
Run this script to authenticate with Schwab and generate your initial token file.

Usage:
    python get_schwab_token.py

This will:
1. Read your credentials from schwab_config.toml
2. Open a browser for Schwab OAuth authentication
3. Save the tokens to schwab_tokens.json

The tokens will auto-refresh as long as they're used within 7 days.
"""

import os
import sys
import toml
import json
from pathlib import Path

def main():
    # Find config file
    script_dir = Path(__file__).parent
    config_file = script_dir / "schwab_config.toml"
    
    if not config_file.exists():
        print("❌ ERROR: schwab_config.toml not found!")
        print("\n📋 Setup instructions:")
        print("1. Copy schwab_config.toml.template to schwab_config.toml")
        print("2. Edit schwab_config.toml with your Schwab API credentials")
        print("3. Run this script again")
        print("\n🔗 Get your API credentials at: https://developer.schwab.com/")
        sys.exit(1)
    
    # Load config
    print("📖 Reading configuration from schwab_config.toml...")
    with open(config_file, 'r') as f:
        config = toml.load(f)
    
    consumer_key = config.get('consumer_key', '')
    app_secret = config.get('app_secret', '')
    callback_url = config.get('callback_url', 'https://127.0.0.1:8182')
    token_path = config.get('token_path', 'schwab_tokens.json')
    
    # Validate credentials
    if not consumer_key or consumer_key == 'YOUR_APP_KEY_HERE':
        print("❌ ERROR: consumer_key not set in schwab_config.toml")
        sys.exit(1)
    
    if not app_secret or app_secret == 'YOUR_APP_SECRET_HERE':
        print("❌ ERROR: app_secret not set in schwab_config.toml")
        sys.exit(1)
    
    # Make token path absolute
    if not os.path.isabs(token_path):
        token_path = script_dir / token_path
    
    print(f"✅ Configuration loaded")
    print(f"   Consumer Key: {consumer_key[:8]}...")
    print(f"   Callback URL: {callback_url}")
    print(f"   Token Path: {token_path}")
    
    # Import schwab library
    try:
        import schwab.auth as schwab_auth
    except ImportError:
        print("\n❌ ERROR: schwab-py library not installed!")
        print("\n📦 Install it with:")
        print("   pip install schwab-py")
        sys.exit(1)
    
    print("\n🔐 Starting Schwab OAuth authentication...")
    print("   A browser window will open for you to log in to Schwab")
    print("   After logging in, you'll be redirected to a URL")
    print("   Copy that ENTIRE URL and paste it back here")
    
    try:
        # This will open browser for OAuth flow
        client = schwab_auth.client_from_manual_flow(
            api_key=consumer_key,
            app_secret=app_secret,
            callback_url=callback_url,
            token_path=str(token_path)
        )
        
        # Test the connection
        print("\n✅ Testing connection...")
        account_response = client.get_account_numbers()
        
        if account_response.status_code == 200:
            accounts = account_response.json()
            print(f"\n🎉 SUCCESS! Connected to Schwab API")
            print(f"   Found {len(accounts)} account(s):")
            for acc in accounts:
                acc_num = acc.get('accountNumber', 'N/A')
                print(f"   - Account ending in {acc_num[-4:]}")
            
            print(f"\n💾 Token saved to: {token_path}")
            print(f"\n✅ You're all set! The token will auto-refresh for the next 7 days.")
            print(f"   Just make sure to use the API at least once every 7 days to keep it active.")
        else:
            print(f"\n❌ ERROR: Failed to connect (status {account_response.status_code})")
            print(f"   Response: {account_response.text}")
            sys.exit(1)
            
    except KeyboardInterrupt:
        print("\n\n⚠️  Authentication cancelled by user")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == '__main__':
    main()

