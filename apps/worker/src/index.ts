import dotenv from "dotenv";
import path from "path";

dotenv.config({
  path: path.join(__dirname, "../../../.env"),
});

import { Worker } from "bullmq";
import { connection, PR_ANALYSIS_QUEUE, type PrAnalysisJob } from "@repo/queue";
import { getDiff, getPRFiles, postReviewWithComments, findDiffLine } from "@repo/github";
import { db, eq } from "@repo/db";
import { analyzePR } from "@repo/groq";
import { reviews, jobs, review_comments } from "@repo/db/schema";

type MappedComment = {
  path: string;
  line: number;
  body: string;
  severity: string;
  category: string;
};

// -----------------------------
// DB helpers
// -----------------------------
async function markReviewProcessing(reviewId: string) {
  await db
    .update(reviews)
    .set({ status: "processing", started_at: new Date() })
    .where(eq(reviews.id, reviewId));
}

async function markReviewCompleted(
  reviewId: string,
  summary: string,
  filesAnalyzed: number,
  durationMs: number,
) {
  await db
    .update(reviews)
    .set({
      status: "completed",
      summary,
      files_analyzed: filesAnalyzed,
      duration_ms: durationMs,
      completed_at: new Date(),
    })
    .where(eq(reviews.id, reviewId));
}

async function markReviewFailed(reviewId: string, errorMessage: string) {
  await db
    .update(reviews)
    .set({ status: "failed", error_message: errorMessage, completed_at: new Date() })
    .where(eq(reviews.id, reviewId));
}

async function markJobCompleted(bullJobId: string) {
  await db
    .update(jobs)
    .set({ status: "completed", updated_at: new Date() })
    .where(eq(jobs.bull_job_id, bullJobId));
}

async function markJobFailed(bullJobId: string, reason: string, attempts: number) {
  await db
    .update(jobs)
    .set({ status: "failed", failed_reason: reason, attempts, updated_at: new Date() })
    .where(eq(jobs.bull_job_id, bullJobId));
}

// -----------------------------
// Worker
// -----------------------------
const worker = new Worker<PrAnalysisJob>(
  PR_ANALYSIS_QUEUE,
  async (job) => {
    const start = Date.now();
    const { reviewId, prNumber, installationId, owner, repo } = job.data;

    console.log(`[job:${job.id}] Starting — PR #${prNumber} (${owner}/${repo})`);

    try {
      await markReviewProcessing(reviewId);

      // 1. Fetch diff + files
      const [diff, files] = await Promise.all([
        getDiff(owner, repo, prNumber, installationId),
        getPRFiles(owner, repo, prNumber, installationId),
      ]);

      console.log(`[job:${job.id}] Fetched diff and ${files.length} files`);

      // 2. Run AI analysis
      const aiResult = await analyzePR(diff, files);
      const rawComments = aiResult.comments ?? []; // guard against null/undefined

      console.log(`[job:${job.id}] AI returned ${rawComments.length} comment(s)`);

      // 3. Map AI comments to valid diff lines
      const mappedComments: MappedComment[] = [];

      for (const c of rawComments) {
        const file = files.find((f) => f.filename === c.file_path);

        if (!file?.patch) {
          console.warn(`[job:${job.id}] No patch for ${c.file_path}, skipping`);
          continue;
        }

        const line = findDiffLine(file.patch, c.line_hint);

        if (line === null) {
          console.warn(`[job:${job.id}] Could not map line ${c.line_hint} in ${c.file_path}, skipping`);
          continue;
        }

        console.log(`[job:${job.id}] ${c.file_path}:${c.line_hint} → line ${line}`);

        mappedComments.push({
          path: c.file_path,
          line,
          body: c.body,
          severity: c.severity,
          category: c.category,
        });
      }

      // 4. Post to GitHub — must succeed before we touch the DB
      await postReviewWithComments(owner, repo, prNumber, installationId, {
        body: aiResult.summary,
        event: "COMMENT",
        comments: mappedComments.map(({ path, line, body }) => ({ path, line, body })),
      });

      console.log(`[job:${job.id}] Posted review with ${mappedComments.length} inline comment(s)`);

      // 5. Persist only the comments that actually made it to GitHub
      if (mappedComments.length > 0) {
        await db.insert(review_comments).values(
          mappedComments.map((c) => ({
            review_id: reviewId,
            file_path: c.path,
            line: c.line,
            side: "RIGHT" as const,
            severity: c.severity,
            category: c.category,
            body: c.body,
          })),
        );
      }

      // 6. Mark success
      await markReviewCompleted(reviewId, aiResult.summary, files.length, Date.now() - start);
      await markJobCompleted(job.id!);

      console.log(`[job:${job.id}] Completed in ${Date.now() - start}ms`);
    } catch (error: any) {
      console.error(`[job:${job.id}] Failed:`, error);

      await markReviewFailed(reviewId, error.message ?? "Unknown error");
      await markJobFailed(job.id!, error.message ?? "Unknown error", job.attemptsMade);

      throw error; // let BullMQ retry
    }
  },
  {
    connection,
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5),
  },
);

// -----------------------------
// Events
// -----------------------------
worker.on("completed", (job) => console.log(`[job:${job.id}] Done`));
worker.on("failed", (job, err) => console.error(`[job:${job?.id}] Failed: ${err.message}`));

async function shutdown() {
  console.log("Shutting down worker...");
  await worker.close();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log("Worker started...");