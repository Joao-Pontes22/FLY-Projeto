import os
import secrets
from fastapi import HTTPException, Request

def require_connector(request: Request):
    key=os.getenv('FLY_CONNECTOR_KEY','')
    if len(key)<32: raise HTTPException(503, 'Conector ainda não configurado')
    if not secrets.compare_digest(request.headers.get('authorization',''), 'Bearer '+key):
        raise HTTPException(401, 'Autenticação do conector necessária')
