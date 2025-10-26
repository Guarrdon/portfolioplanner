#!/usr/bin/env python3
"""
Debug script to check credential format and hidden characters
"""
import toml
from pathlib import Path

config_file = Path(__file__).parent / "schwab_config.toml"
with open(config_file, 'r') as f:
    config = toml.load(f)

consumer_key = config['consumer_key']
app_secret = config['app_secret']

print("=" * 60)
print("CREDENTIAL DIAGNOSTIC")
print("=" * 60)

print(f"\n📋 Consumer Key:")
print(f"   Length: {len(consumer_key)}")
print(f"   Value: {consumer_key}")
print(f"   Bytes: {consumer_key.encode()}")

print(f"\n🔑 App Secret:")
print(f"   Length: {len(app_secret)}")
print(f"   Value: '{app_secret}'")
print(f"   Repr: {repr(app_secret)}")
print(f"   Bytes: {app_secret.encode()}")

# Check for common issues
issues = []

if consumer_key != consumer_key.strip():
    issues.append("⚠️  Consumer key has leading/trailing whitespace")
    
if app_secret != app_secret.strip():
    issues.append("⚠️  App secret has leading/trailing whitespace")

if '`' in app_secret:
    issues.append("⚠️  App secret contains backtick character")
    
if '"' in app_secret or "'" in app_secret:
    issues.append("⚠️  App secret contains quote characters")

# Check encoding
try:
    app_secret.encode('ascii')
except UnicodeEncodeError:
    issues.append("⚠️  App secret contains non-ASCII characters")

print("\n🔍 Issues Found:")
if issues:
    for issue in issues:
        print(f"   {issue}")
else:
    print("   ✅ No obvious formatting issues detected")

print("\n💡 Next Steps:")
print("   1. Go to https://developer.schwab.com/")
print("   2. Go to 'My Apps' and find your app")
print("   3. Look for 'App Key' and 'Secret'")
print("   4. The App Key should be 32 characters")
print("   5. The Secret should be 16 characters")
print(f"\n   Your App Key length: {len(consumer_key)} (expected: 32)")
print(f"   Your Secret length: {len(app_secret)} (expected: 16)")

if len(consumer_key) != 32:
    print("   ❌ App Key length is wrong!")
    
if len(app_secret) != 16:
    print("   ❌ App Secret length is wrong!")
    print("   💡 You may need to regenerate your secret")

print("\n" + "=" * 60)

