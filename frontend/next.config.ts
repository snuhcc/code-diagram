import type { NextConfig } from 'next'

//MEMO: 이거 때문에 useEffect가 2번 호출되는 문제가 발생
const nextConfig: NextConfig = {
  reactStrictMode: true
}

export default nextConfig
