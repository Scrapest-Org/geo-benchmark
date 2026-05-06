import os
import asyncio
import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from x_client_transaction.utils import generate_headers
from .service import TransactionService, get_rotated_proxy, get_client

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

PROXY_URL = os.getenv("PROXY_URL")
REFRESH_INTERVAL = 600

if PROXY_URL is None:
    raise ValueError("PROXY_URL environment variable must be set")

service = TransactionService(proxy_url=PROXY_URL)

async def background_refresh_loop():
    """Persistent loop to keep the ClientTransaction object fresh."""
    proxy_url = get_rotated_proxy(PROXY_URL) # type: ignore
    async with get_client(proxy_url) as client:
        while True:
            await asyncio.sleep(REFRESH_INTERVAL)
            logger.info("Running scheduled refresh...")
            await service.refresh(_client=client)

@asynccontextmanager
async def lifespan(app: FastAPI):
    await service.refresh()
    refresh_task = asyncio.create_task(background_refresh_loop())
    
    yield
    refresh_task.cancel()
    try:
        await refresh_task
    except asyncio.CancelledError:
        pass

app = FastAPI(lifespan=lifespan)

class TransactionRequest(BaseModel):
    method: str
    url: str

@app.post("/transaction-id")
async def get_transaction_id(req: TransactionRequest):
    tx_id = await service.generate_id(method=req.method, url=req.url)

    if tx_id is None:
        raise HTTPException(
            status_code=503, 
            detail="Transaction service not initialized or X is unreachable"
        )
    
    return {"transaction_id": tx_id}

@app.post("/refetch")
async def manual_refetch():
    """Trigger an immediate rotation and refresh of the Transaction ID state."""
    logger.info("Manual refresh triggered via API")
    success = await service.refresh()
    if not success:
        raise ValueError("Manual refetch failed")
    return {"ok": True}

@app.get("/health")
async def health():
    is_ok = service.ct is not None
    return {"ok": is_ok}
