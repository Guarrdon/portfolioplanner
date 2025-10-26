#!/usr/bin/env python3
"""
Quick script to try using an existing OAuth code
Run immediately after getting the redirect URL
"""
import sys
import toml
import requests
from pathlib import Path

def main():
    # Load config
    config_file = Path(__file__).parent / "schwab_config.toml"
    with open(config_file, 'r') as f:
        config = toml.load(f)
    
    consumer_key = config['consumer_key']
    app_secret = config['app_secret']
    callback_url = config['callback_url']
    
    # Get the authorization code from user
    redirect_url = input("Paste the redirect URL: ").strip()
    
    # Extract the code from URL
    if 'code=' not in redirect_url:
        print("❌ No authorization code found in URL")
        sys.exit(1)
    
    # Parse code
    code = redirect_url.split('code=')[1].split('&')[0]
    print(f"📝 Extracted code: {code[:20]}...")
    
    # Exchange code for token
    print("🔄 Attempting to exchange code for token...")
    
    token_url = "https://api.schwabapi.com/v1/oauth/token"
    
    data = {
        'grant_type': 'authorization_code',
        'code': code,
        'redirect_uri': callback_url
    }
    
    auth = (consumer_key, app_secret)
    
    try:
        response = requests.post(token_url, data=data, auth=auth)
        
        if response.status_code == 200:
            print("✅ SUCCESS! Token received")
            token_data = response.json()
            
            # Save token
            import json
            from datetime import datetime
            
            token_data['timestamp'] = datetime.now().isoformat()
            
            token_file = Path(__file__).parent / config.get('token_path', 'schwab_tokens.json')
            with open(token_file, 'w') as f:
                json.dump(token_data, f, indent=2)
            
            print(f"💾 Token saved to: {token_file}")
            print("🎉 You're all set!")
        else:
            print(f"❌ ERROR: {response.status_code}")
            print(f"Response: {response.text}")
            print("\n💡 This likely means:")
            print("   1. The code has expired (codes last ~5 minutes)")
            print("   2. The app_secret is incorrect")
            print("   3. The redirect_uri doesn't match")
            sys.exit(1)
            
    except Exception as e:
        print(f"❌ ERROR: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()

