import requests
from fastapi import APIRouter
from pydantic import BaseModel

from Olist.config import API_URL
from Olist.utils.token import get_auth_headers

router = APIRouter(prefix="/separacoes", tags=["Separações"])


class SituacaoSchema(BaseModel):
    situacao: int


@router.get("")
def listar_separacoes():
    headers = get_auth_headers()

    todas_separacoes = []

    for offset in [0, 100, 200]:
        response = requests.get(
            f"{API_URL}/separacao",
            headers=headers,
            params={
                "limit": 100,
                "offset": offset,
                "idFormaEnvio": 340639609,
            },
        )

        response.raise_for_status()  # Lança erro se a API retornar 4xx/5xx

        dados = response.json()

        # Ajuste "itens" para o nome correto da chave retornada pela API
        todas_separacoes.extend(dados.get("itens", []))

    return {
        "itens": todas_separacoes,
        "total": len(todas_separacoes)
    }


@router.get("/{separacao_id}")
def obter_separacao(separacao_id: int):
    headers = get_auth_headers()
    response = requests.get(
        f"{API_URL}/separacao/{separacao_id}",
        headers=headers,
    )
    return response.json()


@router.put("/{separacao_id}/situacao")
def atualizar_situacao(separacao_id: int, body: SituacaoSchema):
    headers = get_auth_headers()
    headers["Content-Type"] = "application/json"
    response = requests.put(
        f"{API_URL}/separacao/{separacao_id}/situacao",
        headers=headers,
        json=body.model_dump(),
    )
    if not response.content:
        return {"status": response.status_code, "mensagem": "Situação atualizada com sucesso."}
    return response.json()
