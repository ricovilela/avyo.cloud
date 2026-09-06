/**
 * Prisma seed — placeholder.
 *
 * This is a no-op seed script. It intentionally writes NO records and does not
 * require a database connection, so it runs to completion and exits 0 even
 * without a reachable database.
 *
 * Later specs will populate global catalogs (official colors, color classes)
 * and default lookups (status, management) here. See mvp-project.md §10.2.
 */
async function main(): Promise<void> {
  // No records to seed yet. Instantiating PrismaClient is intentionally avoided
  // so this placeholder does not require a DB connection.
  console.log("Seed placeholder — nothing to seed yet.");
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
