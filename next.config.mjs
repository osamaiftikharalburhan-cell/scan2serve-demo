/** @type {import('next').NextConfig} */
const nextConfig = {
  // lets `next build` run in a separate folder while `next dev` is running
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // the restaurant was renamed — old links and already-printed QR codes keep working
  async redirects() {
    return [
      {
        source: '/:area(r|admin|staff|kitchen)/al-burhan/:path*',
        destination: '/:area/kababjees-fried-chicken/:path*',
        permanent: false,
      },
    ];
  },
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '*.supabase.co' }],
  },
};

export default nextConfig;
