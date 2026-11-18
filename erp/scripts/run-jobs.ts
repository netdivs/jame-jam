// Scheduled job runner (TJ-01). Runs every daily job that has not run yet for today's business date, prints a
// one-line JSON summary and exits non-zero if a job failed. Safe to run as often as you like.
//   npx tsx scripts/run-jobs.ts
// Production: the `jobs` service in docker-compose.prod.yml runs this every hour.
import { prisma } from "../src/server/core";
import { runDailyJobs } from "../src/server/jobs";

runDailyJobs()
  .then(async (out) => {
    console.log(JSON.stringify({ at: new Date().toISOString(), jobs: out }));
    await prisma.$disconnect();
    process.exit(out.some((o) => o.status === "FAILED") ? 1 : 0);
  })
  .catch(async (e) => {
    console.error(JSON.stringify({ at: new Date().toISOString(), error: e instanceof Error ? e.message : String(e) }));
    await prisma.$disconnect();
    process.exit(1);
  });
