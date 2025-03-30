import httpx


def proxy(proxy_url, test_url):
  proxies = {"all://": proxy_url}  # httpx 需要使用 "all://" 指定所有协议
  try:
    with httpx.Client(proxies=proxies, timeout=1) as client:
      response = client.get(test_url)
      if response.status_code == 200:
        print(response.text[:100])
        print(f"{proxy_url} 可用，成功访问 {test_url}！")
      else:
        print(f"{proxy_url} 可用，但访问 {test_url} 失败，状态码：{response.status_code}")
  except Exception as e:
    print(f"{proxy_url} 不可用，错误信息：{e}")


# 定义代理
socks5_proxy = "socks5://127.0.0.1:8081"
http_proxy = "http://127.0.0.1:8080"
test_urls = ["https://www.google.com", 'http://example.com']
# 依次测试 SOCKS5 和 HTTP 代理
for test_url in test_urls:
  proxy(http_proxy, test_url)
  proxy(socks5_proxy, test_url)
