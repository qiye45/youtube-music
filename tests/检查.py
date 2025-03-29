import httpx

# proxy_url = "socks5://test:test@172.16.229.142:7891"
proxy_url = "http://127.0.0.1:8080"
test_url = "https://www.google.com"

proxies = {
  "all://": proxy_url,  # httpx 需要使用 "all://" 指定所有协议
}

with httpx.Client(proxies=proxies, timeout=3) as client:
  response = client.get(test_url)
  if response.status_code == 200:
    print(response.text[:100])
    print("代理可用，成功访问 Google！")
  else:
    print(f"代理可用，但访问 Google 失败，状态码：{response.status_code}")

