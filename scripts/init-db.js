#!/usr/bin/env node
const { createUserStorePersistence } = require("../lib/persistence");

async function main() {
  const persistence = createUserStorePersistence();
  if (persistence.kind !== "postgres") {
    throw new Error("DATABASE_URL must point to PostgreSQL before running database initialization.");
  }
  await persistence.init();
  await persistence.close?.();
  console.log("Music Spy database schema is initialized.");
}

main().catch((error) => {
  console.error("Failed to initialize Music Spy database", error);
  process.exit(1);
});
