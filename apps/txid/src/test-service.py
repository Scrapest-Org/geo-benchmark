import asyncio
import os
import logging
import httpx
from service import TransactionService
from x_client_transaction.utils import generate_headers

logging.basicConfig(level=logging.INFO)

async def run_test():
    proxy: str = os.getenv("PROXY_URL") # type: ignore
    print(proxy)
    svc = TransactionService(proxy_url=proxy)

    print("\n--- Test 1: Quick Refresh (Temporary Client) ---")
    success = await svc.refresh()
    if success:
        token = await svc.generate_id("POST", "https://x.com/i/api/graphql/v1/Example")
        print(f"✅ One-off Token: {token}")
    else:
        print("❌ One-off Refresh failed")

    print("\n--- Test 2: Pooled Refresh (Persistent Client) ---")
    # To simulates how main.py runs
    async with httpx.AsyncClient(proxies=proxy, headers=generate_headers()) as client:
        success = await svc.refresh(_client=client)
        if success:
            token = await svc.generate_id("GET", "https://x.com/i/api/2/notifications/all.json")
            print(f"✅ Pooled Token: {token}")
        else:
            print("❌ Pooled Refresh failed")

if __name__ == "__main__":
    try:
        asyncio.run(run_test())
    except KeyboardInterrupt:
        pass