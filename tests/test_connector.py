import os
import unittest
from unittest.mock import patch, Mock
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from Olist.routes import mcp, produtos
from Olist.services import produtos as service

app=FastAPI()
app.include_router(mcp.router)
app.include_router(produtos.router)
client=TestClient(app)
KEY='test-only-connector-key-with-32-chars'

class ConnectorTests(unittest.TestCase):
    def rpc(self, method, params=None):
        return client.post('/mcp',headers={'Authorization':'Bearer '+KEY},json={'jsonrpc':'2.0','id':1,'method':method,'params':params or {}})
    def setUp(self):
        self.env=patch.dict(os.environ,{'FLY_CONNECTOR_KEY':KEY}); self.env.start()
    def tearDown(self): self.env.stop()
    def test_authentication_required(self):
        self.assertEqual(client.post('/mcp',json={}).status_code,401)
    def test_fail_closed_without_key(self):
        with patch.dict(os.environ,{'FLY_CONNECTOR_KEY':''}): self.assertEqual(self.rpc('tools/list').status_code,503)
    def test_discovery_and_initialize(self):
        self.assertEqual(len(self.rpc('tools/list').json()['result']['tools']),3)
        self.assertEqual(self.rpc('initialize',{'protocolVersion':'2025-06-18'}).json()['result']['protocolVersion'],'2025-06-18')
    def test_invalid_arguments_never_call_olist(self):
        with patch.object(mcp,'listar') as fetch:
            for args in [{'limit':0},{'limit':101},{'limit':True},{'offset':-1},{'token':'bad'}]:
                self.assertEqual(self.rpc('tools/call',{'name':'buscar_produtos','arguments':args}).json()['error']['code'],-32602)
            fetch.assert_not_called()
    def test_http_path_plural_and_sku_filter(self):
        response=Mock(status_code=200); response.json.return_value={'itens':[]}
        with patch.object(service,'get_auth_headers',return_value={'Authorization':'Bearer fake'}),patch.object(service.requests,'get',return_value=response) as get:
            service.listar(codigo='N0472')
            self.assertTrue(get.call_args.args[0].endswith('/produtos'))
            self.assertEqual(get.call_args.kwargs['params']['codigo'],'N0472')
            self.assertEqual(get.call_args.kwargs['timeout'],30)
    def test_upstream_error_is_not_success(self):
        response=Mock(status_code=404)
        with patch.object(service,'get_auth_headers',return_value={}),patch.object(service.requests,'get',return_value=response):
            with self.assertRaises(HTTPException) as e: service.listar()
            self.assertEqual(e.exception.status_code,404)
    def test_exact_sku_not_partial(self):
        with patch.object(service,'listar',return_value={'itens':[{'id':1,'sku':'N0472-extra'}]}):
            with self.assertRaises(HTTPException) as e: service.por_sku('N0472')
            self.assertEqual(e.exception.status_code,404)
    def test_duplicate_sku_requires_review(self):
        with patch.object(service,'listar',return_value={'itens':[{'id':1,'sku':'N0472'},{'id':2,'sku':'N0472'}]}):
            with self.assertRaises(HTTPException) as e: service.por_sku('N0472')
            self.assertEqual(e.exception.status_code,409)
    def test_cost_never_falls_back_to_sale_price(self):
        with patch.object(service,'listar',return_value={'itens':[{'id':1,'sku':'N0472'}]}),patch.object(service,'obter',return_value={'id':1,'sku':'N0472','precos':{'preco':105,'precoCustoMedio':41}}):
            result=service.por_sku('N0472')
            self.assertIsNone(result['custo']); self.assertFalse(result['custo_disponivel'])
    def test_cost_and_sale_price_are_distinct(self):
        with patch.object(service,'listar',return_value={'itens':[{'id':1,'sku':'N0472'}]}),patch.object(service,'obter',return_value={'id':1,'sku':'N0472','precos':{'preco':105,'precoCusto':40,'precoCustoMedio':41}}):
            result=service.por_sku('N0472'); self.assertEqual(result['custo'],40); self.assertTrue(result['custo_disponivel'])
    def test_tool_error_flag(self):
        with patch.object(mcp,'por_sku',side_effect=HTTPException(401,'Reconecte o Olist')):
            result=self.rpc('tools/call',{'name':'consultar_custo_por_sku','arguments':{'codigo':'N0472'}}).json()['result']
            self.assertTrue(result['isError'])
    def test_rest_routes_validation(self):
        headers={'Authorization':'Bearer '+KEY}
        self.assertEqual(client.get('/produtos?limit=0',headers=headers).status_code,422)
        self.assertEqual(client.get('/produtos/por-sku/N0472').status_code,401)
        with patch.object(produtos,'por_sku',return_value={'sku':'N0472'}):
            self.assertEqual(client.get('/produtos/por-sku/N0472',headers=headers).json()['sku'],'N0472')

if __name__=='__main__': unittest.main()
