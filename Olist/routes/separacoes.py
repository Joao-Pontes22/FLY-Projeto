import requests
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
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


_ranking_cache: dict[str, tuple[float, dict]] = {}
_RANKING_CACHE_TTL = 180  # segundos — evita bater no rate limit da Tiny a cada render


@router.get("/produtos-do-dia")
def produtos_do_dia(data: str):
    """Agrega quantidades vendidas por descrição de produto para uma data (YYYY-MM-DD).

    A listagem de separações não traz os itens, então buscamos o detalhe
    (que contém `itens`) de cada separação criada na data informada.
    """
    cached = _ranking_cache.get(data)
    if cached and (time.time() - cached[0]) < _RANKING_CACHE_TTL:
        return cached[1]

    headers = get_auth_headers()

    todas_separacoes = []
    for offset in [0, 100, 200]:
        response = requests.get(
            f"{API_URL}/separacao",
            headers=headers,
            params={"limit": 100, "offset": offset, "idFormaEnvio": 340639609},
        )
        response.raise_for_status()
        todas_separacoes.extend(response.json().get("itens", []))

    do_dia = [s for s in todas_separacoes if str(s.get("dataCriacao", "")).startswith(data)]

    def buscar_detalhe(separacao_id):
        try:
            r = requests.get(f"{API_URL}/separacao/{separacao_id}", headers=headers)
            if r.ok:
                return r.json()
        except requests.RequestException:
            pass
        return None

    contagem = {}
    # concorrência baixa para não estourar o rate limit da API da Tiny
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = [executor.submit(buscar_detalhe, s["id"]) for s in do_dia if s.get("id")]
        for future in as_completed(futures):
            detalhe = future.result()
            if not detalhe:
                continue
            for item in detalhe.get("itens", []) or []:
                produto = item.get("produto", {}) or {}
                descricao = (produto.get("descricao") or produto.get("sku") or "Desconhecido").strip()
                quantidade = item.get("quantidade") or 1
                contagem[descricao] = contagem.get(descricao, 0) + quantidade

    ranking = sorted(contagem.items(), key=lambda kv: kv[1], reverse=True)[:10]
    resultado = {"produtos": [{"descricao": nome, "quantidade": qtd} for nome, qtd in ranking]}
    _ranking_cache[data] = (time.time(), resultado)
    return resultado


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
