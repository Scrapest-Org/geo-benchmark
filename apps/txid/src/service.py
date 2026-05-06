import httpx
import asyncio
import bs4
import logging
import random
import string
import ssl

from urllib.parse import urlparse
from x_client_transaction import ClientTransaction
from x_client_transaction.utils import generate_headers, get_ondemand_file_url

logger = logging.getLogger(__name__)
ssl_context = ssl.create_default_context()
ssl_context.set_ciphers('DEFAULT@SECLEVEL=1')

class TransactionService:
    def __init__(self, proxy_url: str) -> None:
        self.proxy_url: str = proxy_url
        self.ct: ClientTransaction | None = None
        self.lock = asyncio.Lock()

    async def refresh(self, _client: httpx.AsyncClient | None = None, retries = 3) -> bool:
        """Fetches new tokens from X."""
        client = _client or get_client(self.proxy_url)
        
        for attempt in range(retries):
            try:
                home_res = await client.get("https://x.com", timeout=15.0)
                home_res.raise_for_status()
                
                soup = bs4.BeautifulSoup(home_res.content, "html.parser") # type: ignore
                ondemand_url = get_ondemand_file_url(response=soup)
                
                js_res = await client.get(ondemand_url, timeout=15.0)
                js_res.raise_for_status()
                
                new_ct = ClientTransaction(
                    home_page_response=soup,
                    ondemand_file_response=js_res.text,
                )

                async with self.lock:
                    self.ct = new_ct
                
                logger.info("ClientTransaction successfully updated.")            
                return True
            except Exception as e:
                wait_time = (attempt + 1) * 2
                logger.warning(f"Refresh attempt {attempt+1} failed: {e}. Retrying in {wait_time}s...")
                self.proxy_url = get_rotated_proxy(self.proxy_url)
                if attempt < retries - 1:
                    await asyncio.sleep(wait_time)
                else:
                    logger.error("All refresh attempts failed.")
        if not _client: await client.aclose()
        return False

    async def generate_id(self, method: str, url: str) -> None | str:
        async with self.lock:
            if not self.ct:
                return None
            
        path = urlparse(url).path
        
        try:
            return self.ct.generate_transaction_id(method=method.upper(), path=path)
        except Exception as e:
            logger.error(f"ID Generation error: {e}")
            return None
        
def get_rotated_proxy(base_url: str) -> str:
        """
        Appends a random session ID - Example: http://user-session-abc:pass@host:port
        """
        if not base_url or "@" not in base_url:
            return base_url
        
        session_id = ''.join(random.choices(string.ascii_lowercase + string.digits, k=5))
        
        auth, rest = base_url.split("@")
        if ":" in auth:
            user, pwd = auth.rsplit(":", 1)
            return f"{user}-session-{session_id}:{pwd}@{rest}"
        return base_url

def get_client(proxy_url: str):
    if proxy_url.startswith("https://"):
        proxy_url = proxy_url.replace("https://", "http://", 1)
    elif not proxy_url.startswith("http://"):
        proxy_url = f"http://{proxy_url}"
    
    logger.info(f"Connecting to Proxy: {proxy_url[:30]}...")

    return httpx.AsyncClient(
        # proxies=proxy_url, 
        proxies={
            "http://": proxy_url,
            "https://": proxy_url,
        },
        headers=generate_headers(), 
        verify=True,
        http2=False,      
        timeout=30.0,
        follow_redirects=True
    )