from fastapi import APIRouter, Query, Depends
from Olist.security import require_connector
from Olist.services.produtos import listar, obter, por_sku

router = APIRouter(prefix="/produtos", tags=["Produtos"], dependencies=[Depends(require_connector)])


@router.get("")
def listar_produtos(limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0), codigo: str | None = None, nome: str | None = None):
    return listar(limit, offset, codigo, nome)


@router.get("/por-sku/{codigo}")
def obter_produto_por_sku(codigo: str):
    return por_sku(codigo)


@router.get("/{produto_id}")
def obter_produto(produto_id: int):
    return obter(produto_id)
