import { pool } from "./index.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function migrate() {
  console.log("Starting database migration...");
  const client = await pool.connect();
  
  try {
    let schemaPath = path.join(__dirname, "schema.sql");
    if (!fs.existsSync(schemaPath)) {
      schemaPath = path.join(__dirname, "../../src/db/schema.sql");
    }
    const schemaSql = fs.readFileSync(schemaPath, "utf-8");

    console.log("Executing schema.sql...");
    await client.query(schemaSql);
    console.log("Migration completed successfully.");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
