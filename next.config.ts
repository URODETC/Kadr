import type { NextConfig } from 'next';
const config:NextConfig={output:'standalone',poweredByHeader:false,images:{unoptimized:true},async headers(){return [{source:'/:path*',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'X-Frame-Options',value:'DENY'},{key:'Referrer-Policy',value:'no-referrer'},{key:'Cache-Control',value:'private, no-store'},{key:'Content-Security-Policy',value:"frame-ancestors 'none'; object-src 'none'; base-uri 'self'"}]}]}};
export default config;
