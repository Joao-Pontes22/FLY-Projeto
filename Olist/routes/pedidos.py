import requests
from fastapi import APIRouter

from Olist.config import API_URL
from Olist.utils.token import get_auth_headers
from pydantic import BaseModel

router = APIRouter(prefix="/pedidos", tags=["Pedidos"])

class SituacaoRequest(BaseModel):
    situacao: int


@router.get("")
def listar_pedidos(limit: int = 100, offset: int = 0):
    headers = get_auth_headers()

    response = requests.get(
        f"{API_URL}/pedidos",
        headers=headers,
        params={
            "limit": limit,
            "offset": offset,
        },
    )

    print("=" * 80)
    print("STATUS:", response.status_code)
    print("CONTENT-TYPE:", response.headers.get("Content-Type"))
    print("URL:", response.url)
    print("BODY:")
    print(response.text)
    print("=" * 80)

    dados = response.json()

    itens = dados.get("itens", [])

    itens = [
        p for p in itens
        if (p.get("ecommerce", {}).get("numeroPedidoEcommerce"))
    ]
    print("STATUS:", response.status_code)
    print("HEADERS:", response.headers.get("Content-Type"))
    print("BODY:")
    print(response.text[:1000])   # primeiros 1000 caracteres
    return itens


@router.get("/{pedido_id}")
def obter_pedido(pedido_id: int):
    headers = get_auth_headers()
    response = requests.get(
        f"{API_URL}/pedidos/{pedido_id}",
        headers=headers,
    )
    return response.json()

@router.put("/{pedido_id}/situacao")
def atualizar_pedido(pedido_id: int, body: SituacaoRequest):
    headers = get_auth_headers()

    response = requests.put(
        f"{API_URL}/pedidos/{pedido_id}/situacao",
        headers=headers,
        json=body.model_dump(),
    )

    if response.status_code == 204:
        return {
            "success": True,
            "status": 204,
            "mensagem": "Situação atualizada com sucesso."
        }

    if response.text:
        return response.json()

    return {
        "success": response.ok,
        "status": response.status_code
    }
