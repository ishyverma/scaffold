import dotenv from "dotenv";
import path from "path";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

dotenv.config({
  path: path.join(__dirname, "../../../.env")
})

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is missing")
}

const pool = new Pool({
  connectionString
});

export const db = drizzle({ client: pool });
export { eq, inArray } from "drizzle-orm";