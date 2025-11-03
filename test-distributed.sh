#!/bin/bash
# Quick test script to verify distributed setup

echo "Testing Distributed Setup..."
echo ""

echo "=== Collaboration Service ==="
curl -s http://localhost:9000/health | python3 -m json.tool
echo ""

echo "=== Backend A (port 8000) ==="
curl -s http://localhost:8000/health | python3 -m json.tool
echo ""

echo "=== Backend B (port 8001) ==="
curl -s http://localhost:8001/health | python3 -m json.tool
echo ""

echo "=== Frontend A Bundle (should use 8000) ==="
curl -s http://localhost:3000/static/js/bundle.js 2>/dev/null | grep -o "localhost:800[0-9]" | head -1
echo ""

echo "=== Frontend B Bundle (should use 8001) ==="
curl -s http://localhost:3001/static/js/bundle.js 2>/dev/null | grep -o "localhost:800[0-9]" | head -1
echo ""

echo "✅ If Frontend A shows 8000 and Frontend B shows 8001, setup is correct!"
