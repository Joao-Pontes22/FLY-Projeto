import json
import requests
from pathlib import Path

TOKEN_FILE = Path(__file__).parent / "Olist" / "token.json"

with open(TOKEN_FILE, encoding="utf-8") as f:
    token = json.load(f)

headers = {
    "Authorization": f"Bearer {token['access_token']}",
    "Accept": "application/json",
}

r = requests.get(
    "https://api.tiny.com.br/public-api/v3/pedidos?limit=1",
    headers=headers,
)

print("STATUS:", r.status_code)
print("REQUEST HEADERS:", r.request.headers)
print("RESPONSE HEADERS:", r.headers)
print("BODY:", repr(r.text))