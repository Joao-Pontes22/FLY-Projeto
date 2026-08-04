import requests
from fastapi import APIRouter

from Olist.config import API_URL
from Olist.utils.token import get_auth_headers

router = APIRouter(prefix="/produtos", tags=["Produtos"])


@router.get("")
def listar_produtos(limit: int = 20, offset: int = 0):
    headers = get_auth_headers()
    response = requests.get(
        f"{API_URL}/produto",
        headers=headers,
        params={"limit": limit, "offset": offset},
    )
    return response.json()


@router.get("/{produto_id}")
def obter_produto(produto_id: int):
    headers = get_auth_headers()
    response = requests.get(
        f"{API_URL}/produto/{produto_id}",
        headers=headers,
    )
    return response.json()
