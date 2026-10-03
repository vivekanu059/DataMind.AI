import "dotenv/config"
import { PrismaClient } from '@prisma/client';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

// Ensure process.env.DATABASE_URL is defined here
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
}

const pool = new Pool({ connectionString });
const adapter = new PrismaNeon({ connectionString });

export const prisma = new PrismaClient({ adapter });