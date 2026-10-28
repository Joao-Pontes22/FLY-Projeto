"""Consultas de produtos e balanço de estoque autenticado, sem Postgres."""
from typing import Annotated

import requests
from fastapi import APIRouter, Query, Depends, Path, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictBool

from Olist.config import API_URL
from Olist.security import require_connector
from Olist.services.produtos import listar, obter, por_sku, consultar
from Olist.utils.token import get_auth_headers

router = APIRouter(prefix="/produtos", tags=["Produtos"], dependencies=[Depends(require_connector)])
NumeroNaoNegativo = Annotated[float, Field(strict=True, ge=0, allow_inf_nan=False)]


class BalancoEstoque(BaseModel):
    model_config = ConfigDict(extra="forbid")

    quantidade: NumeroNaoNegativo = Field(description="Novo saldo físico do depósito; não é uma entrada ou saída.")
    deposito_id: Annotated[int, Field(strict=True, gt=0)]
    preco_unitario: NumeroNaoNegativo = Field(description="Valor unitário do lançamento, exigido pelo Olist; informe explicitamente.")
    observacoes: Annotated[str, Field(strict=True, max_length=500)] = "Balanço via conector FLY"
    confirmar_alteracao: StrictBool = False


@router.get("")
def listar_produtos(limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0), codigo: str | None = None, nome: str | None = None):
    return listar(limit, offset, codigo, nome)


@router.get("/por-sku/{codigo}")
def obter_produto_por_sku(codigo: str):
    return por_sku(codigo)


@router.get("/por-sku/{codigo}/estoque")
def obter_estoque_por_sku(codigo: str):
    produto = por_sku(codigo)
    return consultar(f"/estoque/{produto['produto_id']}")


def _balanco(produto_id: int, dados: BalancoEstoque):
    produto = obter(produto_id)
    # Confirma produto e depósito antes de qualquer escrita.
    deposito = consultar(f"/depositos/{dados.deposito_id}")
    if deposito.get("id") != dados.deposito_id:
        raise HTTPException(502, "Depósito retornado pelo Olist difere do solicitado")
    anterior = consultar(f"/estoque/{produto_id}")
    payload = {
        "tipo": "B",
        "quantidade": dados.quantidade,
        "deposito": {"id": dados.deposito_id},
        "precoUnitario": dados.preco_unitario,
        "observacoes": dados.observacoes,
    }
    previa = {
        "produto_id": produto_id,
        "sku": produto.get("sku"),
        "descricao": produto.get("descricao"),
        "estoque_anterior": anterior,
        "payload_olist": payload,
        "aviso": "Balanço: a quantidade substitui o saldo físico do depósito informado.",
    }
    if not dados.confirmar_alteracao:
        return {"status": "previa", "alterado": False, **previa}

    base = (API_URL or "https://api.tiny.com.br/public-api/v3").rstrip("/")
    try:
        response = requests.post(
            f"{base}/estoque/{produto_id}", headers=get_auth_headers(),
            json=payload, timeout=30, allow_redirects=False,
        )
    except requests.RequestException:
        # Um timeout não prova que o lançamento falhou; nunca repetir automaticamente.
        raise HTTPException(502, "Resultado do envio incerto. Consulte o estoque e os lançamentos no Olist antes de repetir.") from None
    if not 200 <= response.status_code < 300:
        messages = {
            400: "Olist rejeitou o lançamento; confira quantidade, depósito e preço unitário",
            401: "Reconecte a conta FLY no Olist",
            403: "Sem permissão para alterar estoque no Olist",
            404: "Produto ou depósito não encontrado no Olist",
            429: "Limite de requisições do Olist atingido",
        }
        status = response.status_code if response.status_code in messages else 502
        raise HTTPException(status, messages.get(response.status_code, "Olist não confirmou o lançamento. Consulte os lançamentos antes de repetir."))
    try:
        resultado = response.json()
    except ValueError:
        raise HTTPException(502, "Resposta inválida após envio. Consulte os lançamentos antes de repetir.") from None
    if not isinstance(resultado, dict) or type(resultado.get("idLancamento")) is not int or resultado["idLancamento"] < 1:
        raise HTTPException(502, "Olist não retornou um ID de lançamento válido. Consulte os lançamentos antes de repetir.")

    retorno = {"status": "lancamento_confirmado", "alterado": True, "id_lancamento": resultado["idLancamento"], **previa}
    try:
        retorno["estoque_atual"] = consultar(f"/estoque/{produto_id}")
        retorno["consulta_posterior"] = "concluida"
    except HTTPException:
        # A escrita já foi confirmada. Não apresentá-la como falha e induzir reenvio.
        retorno["consulta_posterior"] = "pendente"
        retorno["aviso"] = "Lançamento confirmado, mas a consulta posterior falhou. Consulte o saldo; não repita o POST."
    return retorno


@router.post("/por-sku/{codigo}/estoque", summary="Prévia ou balanço de estoque por SKU")
def alterar_estoque_por_sku(codigo: str, dados: BalancoEstoque):
    produto = por_sku(codigo)
    return _balanco(produto["produto_id"], dados)


@router.get("/{produto_id}/estoque")
def obter_estoque(produto_id: int = Path(..., gt=0)):
    return consultar(f"/estoque/{produto_id}")


@router.post("/{produto_id}/estoque", summary="Prévia ou balanço de estoque por ID")
def alterar_estoque(dados: BalancoEstoque, produto_id: int = Path(..., gt=0)):
    """Use confirmar_alteracao=false para prévia e true para gravar o balanço no depósito."""
    return _balanco(produto_id, dados)


@router.get("/{produto_id}")
def obter_produto(produto_id: int = Path(..., gt=0)):
    return obter(produto_id)
