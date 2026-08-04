import requests
from fastapi import APIRouter
from pydantic import BaseModel

from Olist.config import API_URL
from Olist.utils.token import get_auth_headers

router = APIRouter(prefix="/expedição", tags=["expedição"])


class SituacaoSchema(BaseModel):
    situacao: int


@router.get("")
def listar_expedicao(limit: int = 100, offset: int = 0):
    headers = get_auth_headers()
    response = requests.get(
        f"{API_URL}/expedicao",
        headers=headers,
        params={"limit": limit, 
                "offset": offset},
    )
    return response.json()


@router.get("/{expedição_id}")
def obter_expedicao(expedicao_id: int):
    headers = get_auth_headers()
    response = requests.get(
        f"{API_URL}/expedição/{expedicao_id}",
        headers=headers,
    )
    return response.json()


@router.put("/{expedição}/situacao")
def atualizar_situacao(id_agrupamento: int, body: SituacaoSchema):
    headers = get_auth_headers()
    headers["Content-Type"] = "application/json"
    response = requests.put(
        f"{API_URL}/expedição/{id_agrupamento}/expedição",
        headers=headers,
        json=body.model_dump(),
    )
    if not response.content:
        return {"status": response.status_code, "mensagem": "Situação atualizada com sucesso."}
    return response.json()
