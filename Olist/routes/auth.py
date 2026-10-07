import json
import urllib.parse

import requests
from fastapi import APIRouter
from fastapi.responses import RedirectResponse

from Olist.config import AUTH_URL, CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, TOKEN_URL

router = APIRouter(tags=["Auth"])


@router.get("/login")
def login():
    params = {
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": "openid",
    }
    url = AUTH_URL + "?" + urllib.parse.urlencode(params)
    return RedirectResponse(url)


@router.get("/callback")
def callback(code: str):
    data = {
        "grant_type": "authorization_code",
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "redirect_uri": REDIRECT_URI,
        "code": code,
    }

    response = requests.post(TOKEN_URL, data=data, timeout=30)
    token = response.json()

    if "access_token" not in token:
        return {
            "erro": "Falha ao obter o token.",
            "status": response.status_code,
        }

    with open("token.json", "w", encoding="utf-8") as f:
        json.dump(token, f, indent=4, ensure_ascii=False)

    return {"mensagem": "Conta Olist conectada com sucesso."}
