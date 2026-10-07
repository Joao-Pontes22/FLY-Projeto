import requests
from fastapi import HTTPException
from Olist.config import API_URL
from Olist.utils.token import get_auth_headers

def consultar(path, params=None):
    base = API_URL or "https://api.tiny.com.br/public-api/v3"
    try:
        response = requests.get(base.rstrip('/') + path, headers=get_auth_headers(), params=params, timeout=30)
    except requests.RequestException:
        raise HTTPException(502, "Não foi possível consultar o Olist")
    if response.status_code >= 400:
        messages = {401: "Reconecte a conta FLY no Olist", 403: "Sem permissão para consultar produtos", 404: "Recurso não encontrado no Olist", 429: "Limite de consultas do Olist atingido"}
        raise HTTPException(response.status_code if response.status_code in messages else 502, messages.get(response.status_code, "Falha na consulta ao Olist"))
    try: data = response.json()
    except ValueError: raise HTTPException(502, "Resposta inválida do Olist")
    if not isinstance(data, dict) or ("mensagem" in data and "itens" not in data and "id" not in data):
        raise HTTPException(502, "Olist retornou uma resposta de erro")
    return data

def listar(limit=20, offset=0, codigo=None, nome=None):
    params = {"limit": limit, "offset": offset}
    if codigo is not None: params['codigo'] = codigo
    if nome is not None: params['nome'] = nome
    return consultar('/produtos', params)

def obter(produto_id):
    if type(produto_id) is not int or produto_id < 1: raise HTTPException(422, "ID inválido")
    return consultar(f'/produtos/{produto_id}')

def por_sku(codigo):
    codigo = codigo.strip()
    if not codigo: raise HTTPException(422, "Informe o SKU")
    matches = []
    offset = 0
    while True:
        page = listar(100, offset, codigo=codigo)
        items = page.get('itens')
        if not isinstance(items, list): raise HTTPException(502, "Listagem de produtos inválida")
        matches.extend(p for p in items if p.get('sku') == codigo)
        if len(matches) > 1: raise HTTPException(409, "Há mais de um produto com o mesmo SKU")
        if len(items) < 100: break
        offset += 100
        if offset >= 1000: raise HTTPException(409, "Busca excedeu o limite; confira o SKU no Olist")
    if not matches: raise HTTPException(404, "SKU não encontrado na conta conectada")
    product = obter(matches[0]['id'])
    if product.get('sku') != codigo: raise HTTPException(409, "SKU do detalhe difere do produto localizado")
    prices = product.get('precos') or {}
    cost = prices.get('precoCusto')
    return {"produto_id": product['id'], "sku": codigo, "descricao": product.get('descricao'), "custo": cost, "custo_medio": prices.get('precoCustoMedio'), "preco_venda": prices.get('preco'), "estoque": product.get('estoque'), "custo_disponivel": isinstance(cost, (int, float)) and not isinstance(cost, bool) and cost > 0, "fonte_custo": "precos.precoCusto", "moeda": "BRL"}
