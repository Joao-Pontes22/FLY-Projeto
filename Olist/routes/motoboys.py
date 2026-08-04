import sqlite3
from contextlib import contextmanager
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/motoboys", tags=["Motoboys"])

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "motoboys.db"


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def init_db() -> None:
    with get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS motoboys (
                pedido_id   INTEGER PRIMARY KEY,
                motoboy     TEXT    NOT NULL,
                valor_frete REAL,
                hora_saida  TEXT
            )
        """)
        conn.commit()


init_db()


class MotoboyInfo(BaseModel):
    pedidoId: int
    motoboy: str
    valorFrete: float | None = None
    hora_saida: str | None = None


@router.get("")
def listar_motoboys():
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM motoboys").fetchall()
    return {
        str(r["pedido_id"]): {
            "motoboy":     r["motoboy"],
            "valorFrete":  r["valor_frete"],
            "hora_saida":  r["hora_saida"],
        }
        for r in rows
    }


@router.post("")
def gravar_motoboy(info: MotoboyInfo):
    with get_conn() as conn:
        conn.execute("""
            INSERT INTO motoboys (pedido_id, motoboy, valor_frete, hora_saida)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(pedido_id) DO UPDATE SET
                motoboy     = excluded.motoboy,
                valor_frete = COALESCE(excluded.valor_frete, valor_frete),
                hora_saida  = COALESCE(excluded.hora_saida,  hora_saida)
        """, (info.pedidoId, info.motoboy, info.valorFrete, info.hora_saida))
        conn.commit()
        row = conn.execute(
            "SELECT * FROM motoboys WHERE pedido_id = ?", (info.pedidoId,)
        ).fetchone()
    return {
        "success": True,
        "motoboy": {
            "motoboy":    row["motoboy"],
            "valorFrete": row["valor_frete"],
            "hora_saida": row["hora_saida"],
        },
    }
