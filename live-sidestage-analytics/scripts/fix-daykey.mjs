import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Count bad records
  const countResult = await prisma.$queryRaw`
    SELECT COUNT(*) AS bad_records
    FROM gifts
    WHERE "dayKey" != TO_CHAR(
      ("receivedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tokyo',
      'YYYY-MM-DD'
    )
  `;
  console.log("Bad records:", countResult[0].bad_records);

  if (BigInt(countResult[0].bad_records) === 0n) {
    console.log("Nothing to fix.");
    return;
  }

  // Fix bad records
  const updateResult = await prisma.$executeRaw`
    UPDATE gifts
    SET "dayKey" = TO_CHAR(
      ("receivedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tokyo',
      'YYYY-MM-DD'
    )
    WHERE "dayKey" != TO_CHAR(
      ("receivedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tokyo',
      'YYYY-MM-DD'
    )
  `;
  console.log("Fixed records:", updateResult);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error(e); prisma.$disconnect(); process.exit(1); });
