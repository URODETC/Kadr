import {resolve} from 'node:path';
process.env.DATABASE_PATH=resolve(process.env.DATABASE_PATH||'data/anime.sqlite');
await import('../.next/standalone/server.js');
