"""MCP HTTP somente leitura, protegido por chave própria do conector."""
import json
import os
import secrets
from fastapi import APIRouter, Request, HTTPException
from Olist.security import require_connector
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool
from Olist.services.produtos import listar, obter, por_sku

router = APIRouter(tags=['FLY Olist MCP'])
TOOLS = [
    {'name': 'buscar_produtos', 'description': 'Consulta produtos da conta Olist conectada à FLY por SKU (codigo) ou nome, com paginação.', 'inputSchema': {'type':'object','properties': {'codigo':{'type':'string'}, 'nome':{'type':'string'}, 'limit':{'type':'integer','minimum':1,'maximum':100,'default':20}, 'offset':{'type':'integer','minimum':0,'default':0}}, 'additionalProperties':False}},
    {'name': 'consultar_custo_por_sku', 'description': 'Consulta custo cadastrado, custo médio e preço de venda de um SKU exato. Custo ausente ou zero não autoriza precificação.', 'inputSchema': {'type':'object','properties':{'codigo':{'type':'string','minLength':1}},'required':['codigo'],'additionalProperties':False}},
    {'name': 'obter_produto', 'description': 'Consulta detalhes de um produto da conta FLY pelo ID.', 'inputSchema': {'type':'object','properties':{'produto_id':{'type':'integer','minimum':1}},'required':['produto_id'],'additionalProperties':False}},
]
for tool in TOOLS:
    tool['annotations'] = {'readOnlyHint': True, 'destructiveHint': False, 'openWorldHint': True}

def call_tool(name, args):
    tool = next((t for t in TOOLS if t['name']==name), None)
    if tool is None: raise ValueError('Ferramenta desconhecida')
    schema = tool['inputSchema']
    if not isinstance(args, dict) or set(args)-set(schema['properties']): raise ValueError('Argumentos inválidos')
    if any(k not in args for k in schema.get('required',[])): raise ValueError('Argumento obrigatório ausente')
    for k,v in args.items():
        rule=schema['properties'][k]
        if rule['type']=='string' and (not isinstance(v,str) or not v.strip()): raise ValueError('Texto inválido')
        if rule['type']=='integer' and (type(v) is not int or v < rule.get('minimum',0) or v > rule.get('maximum',2**63)): raise ValueError('Número inválido')
    if name=='consultar_custo_por_sku': return por_sku(**args)
    if name=='obter_produto': return obter(args['produto_id'])
    return listar(**args)

@router.post('/mcp')
async def mcp(request: Request):
    require_connector(request)
    try: body=await request.json()
    except Exception: return {'jsonrpc':'2.0','id':None,'error':{'code':-32700,'message':'JSON inválido'}}
    if not isinstance(body,dict) or body.get('jsonrpc')!='2.0': return {'jsonrpc':'2.0','id':None,'error':{'code':-32600,'message':'Requisição inválida'}}
    if 'id' not in body: return Response(status_code=202)
    rid=body['id']; method=body.get('method'); params=body.get('params') or {}
    if not isinstance(params,dict): return {'jsonrpc':'2.0','id':rid,'error':{'code':-32602,'message':'Parâmetros inválidos'}}
    if method=='initialize':
        version=params.get('protocolVersion')
        if version not in ['2024-11-05','2025-03-26','2025-06-18']: version='2025-06-18'
        result={'protocolVersion':version,'capabilities':{'tools':{}},'serverInfo':{'name':'fly-olist','version':'0.1.0'}}
    elif method=='ping': result={}
    elif method=='tools/list': result={'tools':TOOLS}
    elif method=='tools/call':
        try:
            data=await run_in_threadpool(call_tool,params.get('name'),params.get('arguments',{}))
            result={'content':[{'type':'text','text':json.dumps(data,ensure_ascii=False)}],'isError':False}
        except ValueError as e:
            return {'jsonrpc':'2.0','id':rid,'error':{'code':-32602,'message':str(e)}}
        except HTTPException as e:
            result={'content':[{'type':'text','text':str(e.detail)}],'isError':True}
    else: return {'jsonrpc':'2.0','id':rid,'error':{'code':-32601,'message':'Método desconhecido'}}
    return {'jsonrpc':'2.0','id':rid,'result':result}
