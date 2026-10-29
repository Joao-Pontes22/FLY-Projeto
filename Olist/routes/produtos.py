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


class IdentificacaoProduto(BaseModel):
    """Altera somente SKU/localização; não recebe saldo, preço ou composição."""
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    sku_atual: Annotated[str, Field(strict=True, min_length=1, max_length=100)]
    novo_sku: Annotated[str, Field(strict=True, min_length=1, max_length=100)]
    localizacao: Annotated[str, Field(strict=True, max_length=50)]
    revisao: Annotated[str, Field(strict=True, min_length=64, max_length=64)] | None = None
    confirmar_alteracao: StrictBool = False


def _payload_identificacao(produto, dados):
    # Somente campos graváveis documentados nos PUTs de produto/variação.
    # Nunca reenviar quantidade, anexos, kit, custos ou outros campos de leitura.
    from copy import deepcopy
    campos = ("sku", "descricaoComplementar", "unidade", "unidadePorCaixa", "ncm",
              "gtin", "origem", "codigoEspecificadorSubstituicaoTributaria",
              "garantia", "observacoes")
    payload = {k: deepcopy(produto[k]) for k in campos if produto.get(k) is not None}
    pai = produto.get("produtoPai") or {}
    if pai.get("id"):
        if type(pai["id"]) is not int or pai["id"] < 1:
            raise HTTPException(502, "ID do produto pai inválido")
        caminho = f"/produtos/{pai['id']}/variacoes/{produto['id']}"
    else:
        if produto.get("tipoVariacao") == "V":
            raise HTTPException(409, "Variação sem produto pai; confira o cadastro")
        caminho = f"/produtos/{produto['id']}"
        payload["descricao"] = produto["descricao"]
    # O GET retorna origem como texto em alguns cadastros; o PUT exige inteiro.
    if "origem" in payload:
        origem = str(payload["origem"])
        if origem not in tuple(str(i) for i in range(9)):
            raise HTTPException(409, "Origem fiscal inválida; confira o cadastro antes de editar")
        payload["origem"] = int(origem)
    grupos = {
        "marca": ("id",), "categoria": ("id",),
        "precos": ("preco", "precoPromocional", "precoCusto"),
        "dimensoes": ("largura", "altura", "comprimento", "diametro", "pesoLiquido", "pesoBruto"),
        "tributacao": ("gtinEmbalagem", "valorIPIFixo", "classeIPI"),
        "seo": ("titulo", "descricao", "keywords", "linkVideo", "slug"),
        "estoque": ("controlar", "sobEncomenda", "minimo", "maximo", "diasPreparacao", "localizacao"),
    }
    for grupo, permitidos in grupos.items():
        atual = produto.get(grupo)
        if isinstance(atual, dict):
            payload[grupo] = {k: deepcopy(atual[k]) for k in permitidos if atual.get(k) is not None}
    embalagem = (produto.get("dimensoes") or {}).get("embalagem") or {}
    if embalagem.get("id"):
        payload.setdefault("dimensoes", {})["embalagem"] = {"id": embalagem["id"]}
    if produto.get("fornecedores") is not None:
        payload["fornecedores"] = [
            {k: deepcopy(f[k]) for k in ("id", "codigoProdutoNoFornecedor", "padrao") if f.get(k) is not None}
            for f in produto["fornecedores"]
        ]
    payload["sku"] = dados.novo_sku
    payload.setdefault("estoque", {})["localizacao"] = dados.localizacao
    return caminho, payload


def _validar_sku_disponivel(sku, produto_id):
    # Paginar e comparar sem diferença de caixa; nunca aceitar busca truncada.
    for offset in range(0, 10000, 100):
        itens = listar(100, offset, codigo=sku).get("itens")
        if not isinstance(itens, list):
            raise HTTPException(502, "Listagem de produtos inválida")
        if any(str(p.get("sku", "")).strip().casefold() == sku.casefold()
               and p.get("id") != produto_id for p in itens):
            raise HTTPException(409, "SKU de destino já utilizado por outro produto")
        if len(itens) < 100:
            return
    raise HTTPException(409, "Busca de duplicidade excedeu o limite; nenhuma alteração enviada")


@router.patch("/{produto_id}/identificacao", summary="Prévia ou edição de SKU e localização")
def alterar_identificacao(dados: IdentificacaoProduto, produto_id: int = Path(..., gt=0)):
    """Prévia por padrão. Para gravar, repetir os dados com a revisão e confirmar_alteracao=true."""
    import hashlib
    import json

    produto = obter(produto_id)
    if produto.get("id") != produto_id or produto.get("sku") != dados.sku_atual:
        raise HTTPException(409, "Produto ou SKU atual diverge; consulte novamente")
    if produto.get("tipo") == "V" or produto.get("tipoVariacao") == "P":
        raise HTTPException(409, "Edite cada variação individualmente, não o produto pai")
    _validar_sku_disponivel(dados.novo_sku, produto_id)
    caminho, payload = _payload_identificacao(produto, dados)
    revisao = hashlib.sha256(json.dumps(
        {"produto": produto, "caminho": caminho, "payload": payload},
        sort_keys=True, ensure_ascii=False, separators=(",", ":"),
    ).encode()).hexdigest()
    previa = {
        "produto_id": produto_id, "descricao": produto.get("descricao"),
        "antes": {"sku": produto["sku"], "localizacao": (produto.get("estoque") or {}).get("localizacao", "")},
        "depois": {"sku": dados.novo_sku, "localizacao": dados.localizacao},
        "revisao": revisao, "rota_olist": caminho,
    }
    if not dados.confirmar_alteracao:
        return {"status": "previa", "alterado": False, **previa}
    if dados.revisao != revisao:
        raise HTTPException(409, "Prévia ausente ou cadastro alterado; gere uma nova prévia")
    if previa["antes"] == previa["depois"]:
        return {"status": "sem_alteracao", "alterado": False, **previa}
    base = (API_URL or "https://api.tiny.com.br/public-api/v3").rstrip("/")
    try:
        resposta = requests.put(base + caminho, headers=get_auth_headers(), json=payload,
                                timeout=30, allow_redirects=False)
    except requests.RequestException:
        raise HTTPException(502, "Resultado incerto. Consulte o produto por ID antes de repetir; o PUT não será repetido automaticamente.") from None
    if not 200 <= resposta.status_code < 300:
        mensagens = {400: "Olist rejeitou a edição do cadastro", 401: "Reconecte a conta FLY no Olist",
                     403: "Sem permissão para editar produtos", 404: "Produto ou variação não encontrado",
                     429: "Limite de requisições do Olist atingido"}
        raise HTTPException(resposta.status_code if resposta.status_code in mensagens else 502,
                            mensagens.get(resposta.status_code, "Olist não confirmou a edição. Consulte o produto por ID antes de repetir."))
    # PUT documentado retorna 204; não exigir JSON após uma escrita válida.
    try:
        atual = obter(produto_id)
    except HTTPException:
        return {"status": "verificacao_pendente", "alterado": None, **previa,
                "aviso": "Olist aceitou o PUT, mas a consulta posterior falhou. Não repita; consulte por ID."}
    if atual.get("sku") != dados.novo_sku or (atual.get("estoque") or {}).get("localizacao", "") != dados.localizacao:
        return {"status": "divergencia", "alterado": None, **previa,
                "aviso": "A consulta posterior diverge do solicitado. Confira o cadastro por ID; não repita automaticamente."}
    preservados = ("descricao", "precos", "kit", "anexos", "produtoPai")
    divergencias = [k for k in preservados if atual.get(k) != produto.get(k)]
    for k, v in (produto.get("estoque") or {}).items():
        if k != "localizacao" and (atual.get("estoque") or {}).get(k) != v:
            divergencias.append("estoque." + k)
    return {"status": "divergencia" if divergencias else "verificado", "alterado": True,
            "campos_divergentes": divergencias, **previa}

