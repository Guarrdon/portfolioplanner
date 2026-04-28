"""
One-shot probe to verify the Schwab Market Data quotes endpoint is enabled
on the configured app. Run from backend/:

    python probe_quotes.py             # default: AAPL
    python probe_quotes.py AAPL MSFT TSLA

Reuses the same OAuth token file the rest of the app uses. Prints status
and a trimmed response so we can confirm Market Data is in scope before
wiring quotes into the live refresh path.
"""
import json
import os
import sys


def main(symbols):
    try:
        import schwab.auth as schwab_auth
        import toml
    except ImportError as e:
        print(f"missing dependency: {e}", file=sys.stderr)
        sys.exit(2)

    config_path = os.path.join(os.path.dirname(__file__), "schwab_config.toml")
    if not os.path.exists(config_path):
        print(f"config not found: {config_path}", file=sys.stderr)
        sys.exit(2)
    with open(config_path) as f:
        config = toml.load(f)

    consumer_key = config.get("consumer_key")
    app_secret = config.get("app_secret")
    token_path = config.get("token_path", "schwab_tokens.json")
    if not os.path.isabs(token_path):
        token_path = os.path.join(os.path.dirname(__file__), token_path)

    if not (consumer_key and app_secret and os.path.exists(token_path)):
        print("missing credentials or token", file=sys.stderr)
        sys.exit(2)

    client = schwab_auth.client_from_token_file(
        token_path, consumer_key, app_secret, enforce_enums=False
    )

    print(f"calling get_quotes({symbols!r})")
    resp = client.get_quotes(symbols)
    print(f"status: {resp.status_code}")
    try:
        data = resp.json()
    except Exception:
        print(f"non-JSON body: {resp.text[:400]}")
        sys.exit(1)

    if resp.status_code != 200:
        print(json.dumps(data, indent=2)[:1200])
        sys.exit(1)

    for sym, payload in data.items():
        quote = payload.get("quote", {}) if isinstance(payload, dict) else {}
        last = quote.get("lastPrice") or quote.get("mark") or quote.get("closePrice")
        print(f"  {sym}: last={last}  bid={quote.get('bidPrice')}  ask={quote.get('askPrice')}")


if __name__ == "__main__":
    args = sys.argv[1:] or ["AAPL"]
    main(args)
