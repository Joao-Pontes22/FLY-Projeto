import json
from pathlib import Path
from fastapi import HTTPException

BASE_DIR   = Path(__file__).resolve().parent.parent.parent  # raiz do projeto
TOKEN_PATH = BASE_DIR / "token.json"


def get_auth_headers() -> dict:
    if not TOKEN_PATH.exists():
        raise HTTPException(
            status_code=401,
            detail=f"Token não encontrado em: {TOKEN_PATH}"
        )

    with TOKEN_PATH.open("r", encoding="utf-8") as f:
        token = json.load(f)

    if "access_token" not in token:
        raise HTTPException(
            status_code=401,
            detail="Token inválido."
        )

    return {
        "Authorization": f"Bearer {token['access_token']}"
    }