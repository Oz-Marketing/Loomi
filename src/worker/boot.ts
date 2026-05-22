/**
 * Worker boot module. Loads .env / .env.local BEFORE any Prisma-touching
 * import runs. Imported as the very first line of `index.ts` so its
 * top-level side effects fire before ESM resolves the rest of the module
 * graph (which transitively pulls in `src/lib/prisma.ts`, whose
 * PrismaClient reads `process.env.DATABASE_URL` at module load time).
 */
import { config } from 'dotenv';
config({ path: '.env' });
config({ path: '.env.local' });
