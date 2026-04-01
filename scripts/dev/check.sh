#!/usr/bin/env bash
set -euo pipefail

API_GATEWAY_URL=${API_GATEWAY_URL:-http://localhost:3001}
GPT2GIGA_URL=${GPT2GIGA_URL:-http://localhost:8443}

echo "1) gpt2giga direct ping..."
curl -L -X POST "${GPT2GIGA_URL}/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"model":"GigaChat-Pro","messages":[{"role":"user","content":"Столица России?"}]}'
echo -e "\n"

echo "2) gateway chat..."
curl -X POST "${API_GATEWAY_URL}/chat" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Привет, кто ты?"}],"model":"gigachat/GigaChat-Pro"}'
echo -e "\nDone."
