import { PrismaClient } from "@prisma/client";

function withConnectionLimit(url) {
  if (!url) return url;

  try {
    const databaseUrl = new URL(url);

    if (!databaseUrl.searchParams.has("connection_limit")) {
      databaseUrl.searchParams.set("connection_limit", "1");
    }

    if (!databaseUrl.searchParams.has("pool_timeout")) {
      databaseUrl.searchParams.set("pool_timeout", "10");
    }

    return databaseUrl.toString();
  } catch {
    return url;
  }
}

const globalForPrisma = globalThis;

if (!globalForPrisma.prismaGlobal) {
  globalForPrisma.prismaGlobal = new PrismaClient({
    datasources: {
      db: {
        url: withConnectionLimit(process.env.DATABASE_URL),
      },
    },
  });
}

const prisma = globalForPrisma.prismaGlobal;

export default prisma;
