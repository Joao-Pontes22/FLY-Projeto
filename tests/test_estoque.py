import os
import unittest
from unittest.mock import Mock, patch

import requests
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from Olist.routes import produtos

KEY = 'test-only-connector-key-12345678901234567890'
BODY = {'quantidade': 12.5, 'deposito_id': 7, 'preco_unitario': 2.5}


class EstoqueTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'FLY_CONNECTOR_KEY': KEY})
        self.env.start()
        self.addCleanup(self.env.stop)
        app = FastAPI()
        app.include_router(produtos.router)
        self.client = TestClient(app)
        self.headers = {'Authorization': 'Bearer ' + KEY}
        self.post = patch.object(produtos.requests, 'post').start()
        self.get = patch.object(produtos, 'consultar').start()
        self.product = patch.object(produtos, 'obter', return_value={'id': 42, 'sku': 'FLY-42', 'descricao': 'Teste'}).start()
        self.auth = patch.object(produtos, 'get_auth_headers', return_value={'Authorization': 'Bearer fake-olist-token'}).start()
        self.addCleanup(patch.stopall)
        self.get.side_effect = [{'id': 7}, {'saldo': 10}]

    def send(self, body):
        return self.client.post('/produtos/42/estoque', json=body, headers=self.headers)

    def test_preview_does_not_write(self):
        response = self.send(BODY)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['status'], 'previa')
        self.assertFalse(data['alterado'])
        self.assertEqual(data['payload_olist'], {'tipo': 'B', 'quantidade': 12.5, 'deposito': {'id': 7}, 'precoUnitario': 2.5, 'observacoes': 'Balanço via conector FLY'})
        self.post.assert_not_called()

    def test_unauthenticated_request_cannot_read_or_write(self):
        response = self.client.post('/produtos/42/estoque', json=BODY)
        self.assertEqual(response.status_code, 401)
        self.product.assert_not_called()
        self.get.assert_not_called()
        self.post.assert_not_called()

    def test_invalid_values_rejected_before_olist(self):
        for changes in ({'quantidade': -1}, {'quantidade': True}, {'quantidade': '12'}, {'deposito_id': 0}, {'deposito_id': True}, {'preco_unitario': -1}, {'confirmar_alteracao': 'true'}, {'tipo': 'E'}):
            with self.subTest(changes=changes):
                self.assertEqual(self.send({**BODY, **changes}).status_code, 422)
        self.product.assert_not_called()
        self.post.assert_not_called()

    def test_missing_price_rejected(self):
        self.assertEqual(self.send({'quantidade': 1, 'deposito_id': 7}).status_code, 422)
        self.post.assert_not_called()

    def test_deposit_mismatch_blocks_write(self):
        self.get.side_effect = [{'id': 8}]
        self.assertEqual(self.send({**BODY, 'confirmar_alteracao': True}).status_code, 502)
        self.post.assert_not_called()

    def test_confirmed_write_uses_official_endpoint_once(self):
        self.get.side_effect = [{'id': 7}, {'saldo': 10}, {'saldo': 12.5}]
        self.post.return_value = Mock(status_code=200)
        self.post.return_value.json.return_value = {'idLancamento': 99}
        data = self.send({**BODY, 'confirmar_alteracao': True}).json()
        self.assertEqual(data['id_lancamento'], 99)
        self.assertTrue(data['alterado'])
        self.assertEqual(data['consulta_posterior'], 'concluida')
        self.post.assert_called_once()
        args, kwargs = self.post.call_args
        self.assertTrue(args[0].endswith('/estoque/42'))
        self.assertEqual(kwargs['json']['tipo'], 'B')
        self.assertEqual(kwargs['json']['deposito'], {'id': 7})
        self.assertEqual(kwargs['timeout'], 30)
        self.assertFalse(kwargs['allow_redirects'])

    def test_timeout_is_not_retried(self):
        self.post.side_effect = requests.Timeout()
        response = self.send({**BODY, 'confirmar_alteracao': True})
        self.assertEqual(response.status_code, 502)
        self.assertIn('incerto', response.json()['detail'])
        self.post.assert_called_once()

    def test_rejected_and_invalid_responses_do_not_claim_success(self):
        for response in (Mock(status_code=403), Mock(status_code=302), Mock(status_code=200, json=Mock(return_value={})), Mock(status_code=200, json=Mock(side_effect=ValueError()))):
            with self.subTest(response=response):
                self.get.side_effect = [{'id': 7}, {'saldo': 10}]
                self.post.return_value = response
                result = self.send({**BODY, 'confirmar_alteracao': True})
                self.assertIn(result.status_code, (403, 502))

    def test_read_failure_after_write_reports_confirmed_launch(self):
        self.get.side_effect = [{'id': 7}, {'saldo': 10}, HTTPException(502, 'Falha')]
        self.post.return_value = Mock(status_code=200)
        self.post.return_value.json.return_value = {'idLancamento': 99}
        response = self.send({**BODY, 'confirmar_alteracao': True})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['alterado'])
        self.assertEqual(response.json()['consulta_posterior'], 'pendente')

    def test_zero_balance_is_valid(self):
        self.assertEqual(self.send({**BODY, 'quantidade': 0}).status_code, 200)
        self.post.assert_not_called()

    def test_get_stock_and_sku_resolution(self):
        self.get.side_effect = None
        self.get.return_value = {'saldo': 10}
        response = self.client.get('/produtos/42/estoque', headers=self.headers)
        self.assertEqual(response.json()['saldo'], 10)
        self.get.assert_called_with('/estoque/42')
        with patch.object(produtos, 'por_sku', return_value={'produto_id': 42}) as sku:
            response = self.client.get('/produtos/por-sku/FLY-42/estoque', headers=self.headers)
            self.assertEqual(response.json()['saldo'], 10)
            sku.assert_called_once_with('FLY-42')

    def test_invalid_id_is_rejected(self):
        self.assertEqual(self.client.get('/produtos/0/estoque', headers=self.headers).status_code, 422)
        self.get.assert_not_called()


if __name__ == '__main__':
    unittest.main()
