from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from Olist.routes import auth, pedidos, produtos, expedicao, separacoes, motoboys

app = FastAPI(title="Olist / Tiny API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/", tags=["Health"])
def health():
    return {"status": "OK"}


app.include_router(auth.router)
app.include_router(pedidos.router)
app.include_router(produtos.router)
app.include_router(expedicao.router)
app.include_router(separacoes.router)
app.include_router(motoboys.router)