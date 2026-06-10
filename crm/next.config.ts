import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'gmlclkolzcchjstzdilt.supabase.co', pathname: '/storage/v1/object/public/**' },
      { protocol: 'https', hostname: 'chatwoot.chateaulabs.shop' },
    ],
  },
};

export default nextConfig;
