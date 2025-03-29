import asyncio
from aiohttp import web, ClientSession
from aiosocks.connector import ProxyConnector, ProxyClientRequest


async def handle(request):
  # 目标 URL（从请求中提取）
  target_url = request.url.with_scheme("http").with_host(request.headers.get("Host", ""))

  # SOCKS5 代理配置
  socks5_proxy = "socks5h://test:test@172.16.229.142:7891"

  # 使用 aiohttp + aiosocks 发起代理请求
  connector = ProxyConnector.from_url(socks5_proxy)
  async with ClientSession(connector=connector, request_class=ProxyClientRequest) as session:
    async with session.request(
      method=request.method,
      url=str(target_url),
      headers=request.headers,
      data=await request.read(),
    ) as resp:
      # 返回代理服务器的响应
      response = web.StreamResponse(
        status=resp.status,
        headers=resp.headers,
      )
      await response.prepare(request)

      async for chunk in resp.content.iter_chunked(4096):
        await response.write(chunk)

      return response


async def main():
  app = web.Application()
  app.router.add_route("*", "/{path:.*}", handle)

  runner = web.AppRunner(app)
  await runner.setup()
  site = web.TCPSite(runner, "127.0.0.1", 1080)

  print("Proxy server running on http://127.0.0.1:8080")
  await site.start()

  # 保持运行
  while True:
    await asyncio.sleep(3600)


if __name__ == "__main__":
  asyncio.run(main())
