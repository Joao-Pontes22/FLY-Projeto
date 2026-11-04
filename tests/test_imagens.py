import unittest
from unittest.mock import Mock, patch

import requests
from fastapi import FastAPI
from fastapi.testclient import TestClient
from Olist.routes import produtos

PRODUTO = {'produto_id': 42, 'sku': 'FLY-42', 'descricao': 'iPhone 11 Tampa Traseira'}
URL1 = 'https://exemplo.com/foto1.jpg'
URL2 = 'https://exemplo.com/foto2.jpg'


def resp(status, data=None):
    r = Mock(status_code=status)
    r.json.return_value = data
    return r


class ImagensTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(produtos.router)
        self.client = TestClient(app)
        self.sku = patch.object(produtos, 'por_sku', return_value=PRODUTO).start()
        self.get = patch.object(produtos.requests, 'get').start()
        self.post = patch.object(produtos.requests, 'post').start()
        patch.object(produtos, 'get_auth_headers', return_value={'Authorization': 'Bearer fake'}).start()
        self.addCleanup(patch.stopall)
        self.get.return_value = resp(200, [{'id': 1, 'url': URL1, 'externo': True}])

    def enviar(self, body):
        return self.client.post('/produtos/por-sku/FLY-42/imagens', json=body)

    def test_lista_imagens(self):
        r = self.client.get('/produtos/por-sku/FLY-42/imagens')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['imagens'][0]['url'], URL1)

    def test_previa_nao_envia_e_ignora_duplicadas(self):
        r = self.enviar({'urls': [URL1, URL2, URL2]})
        self.assertEqual(r.status_code, 200)
        d = r.json()
        self.assertEqual(d['status'], 'previa')
        self.assertEqual(d['payload_olist'], [{'url': URL2, 'externo': False}])
        self.assertEqual(d['urls_ignoradas'], [URL1, URL2])
        self.post.assert_not_called()

    def test_todas_existentes_sem_alteracao(self):
        d = self.enviar({'urls': [URL1], 'confirmar_alteracao': True}).json()
        self.assertEqual(d['status'], 'sem_alteracao')
        self.post.assert_not_called()

    def test_confirmado_envia_para_olist(self):
        self.post.return_value = resp(200, [{'id': 2, 'url': URL2, 'externo': False}])
        d = self.enviar({'urls': [URL2], 'confirmar_alteracao': True}).json()
        self.assertEqual(d['status'], 'imagens_enviadas')
        args, kwargs = self.post.call_args
        self.assertTrue(args[0].endswith('/produtos/42/anexos'))
        self.assertEqual(kwargs['json'], [{'url': URL2, 'externo': False}])

    def test_timeout_nao_repete(self):
        self.post.side_effect = requests.Timeout()
        r = self.enviar({'urls': [URL2], 'confirmar_alteracao': True})
        self.assertEqual(r.status_code, 502)
        self.assertEqual(self.post.call_count, 1)

    def test_rejeicao_400_repassa_detalhes(self):
        self.post.return_value = resp(400, {'detalhes': [{'campo': 'url', 'mensagem': 'inválida'}]})
        r = self.enviar({'urls': [URL2], 'confirmar_alteracao': True})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()['detail']['detalhes'], [{'campo': 'url', 'mensagem': 'inválida'}])

    def test_entradas_invalidas(self):
        for body in ({'urls': []}, {'urls': ['ftp://x.com/a.jpg']}, {'urls': ['nao-e-url']},
                     {'urls': [URL2] * 21}, {'urls': [URL2], 'confirmar_alteracao': 'true'}, {'urls': [URL2], 'extra': 1}):
            with self.subTest(body=body):
                self.assertEqual(self.enviar(body).status_code, 422)
        self.post.assert_not_called()


if __name__ == '__main__':
    unittest.main()
