import { Hono } from "hono";
// DATABASE_SECRET=mysecretdatabasesecret
import { prAnalysisQueue } from "@repo/queue";
import { db, eq, inArray } from "@repo/db";
import {
  jobs,
  pullRequests,
  repositories,
  reviews,
  webhookEvents,
} from "@repo/db/schema";
import { verifyGithubSignature } from "./lib/verify-github-webhook";

const app = new Hono();

app.get("/", (c) => {
  return c.text("GET /");
});
// phone number - +91 1234567898
app.post("/webhook", async (c) => {
    try {
      // raw body just for HMAC verification
      const rawBody = await c.req.arrayBuffer();
      const payload = await c.req.json()
  
      const event = c.req.header("X-github-event")
      const deliveryId = c.req.header("x-github-delivery")
      const signature = c.req.header("x-hub-signature-256");

      const isValid = await verifyGithubSignature(rawBody, signature);
      if (!isValid) {
        console.warn("Webhook signature verification failed");
        return c.json({ error: "Unauthorized" }, 401);
      }
  
      // -------------------------
      // 0. VALIDATE HEADERS
      // -------------------------
      if (!event || !deliveryId) {
        return c.json({ error: "Missing headers" }, 400)
      }
  
      // -------------------------
      // 1. IDEMPOTENCY
      // -------------------------
      const existing = await db
        .select()
        .from(webhookEvents)
        .where(eq(webhookEvents.deliveryId, deliveryId))
  
      if (existing.length !== 0) {
        return c.json({ duplicate: true })
      }
  
      // -------------------------
      // 2. RESOLVE REPOSITORY
      // -------------------------
      let repositoryId: string | undefined
      const repo = payload.repository
  
      if (repo) {
        const result = await db
          .insert(repositories)
          .values({
            githubRepoId: repo.id,
            owner: repo.owner.login,
            name: repo.name,
            installationId: payload.installation?.id,
            is_active: true,
          })
          .onConflictDoUpdate({
            target: repositories.githubRepoId,
            set: {
              owner: repo.owner.login,
              name: repo.name,
              is_active: true,
              updatedAt: new Date(),
            },
          })
          .returning()
  
        repositoryId = result[0]?.id
      }
  
      // -------------------------
      // 3. INSERT WEBHOOK EVENT
      // -------------------------
      await db.insert(webhookEvents).values({
        deliveryId,
        event,
        action: payload.action,
        repositoryId,
      })
  
      // -------------------------
      // 4. PULL REQUEST EVENTS
      // -------------------------
      if (event === "pull_request") {
        if (!["opened", "synchronize", "reopened"].includes(payload.action)) {
          return c.json({ ignored: true })
        }
  
        if (!repositoryId) {
          return c.json({ error: "Repository not resolved" }, 400)
        }
  
        const pr = payload.pull_request
  
        const result = await db.transaction(async (tx) => {
          // UPSERT PR
          const [prRow] = await tx
            .insert(pullRequests)
            .values({
              repositoryId,
              github_pr_id: pr.id,
              pr_number: pr.number,
              title: pr.title,
              authorLogin: pr.user.login,
              base_branch: pr.base.ref,
              head_branch: pr.head.ref,
              head_sha: pr.head.sha,
              state: pr.state,
            })
            .onConflictDoUpdate({
              target: [pullRequests.repositoryId, pullRequests.github_pr_id],
              set: {
                title: pr.title,
                authorLogin: pr.user.login,
                base_branch: pr.base.ref,
                head_branch: pr.head.ref,
                head_sha: pr.head.sha,
                state: pr.state,
                updatedAt: new Date(),
              },
            })
            .returning()
  
          // CREATE REVIEW
          const [review] = await tx
            .insert(reviews)
            .values({
              pull_request_id: prRow?.id as string,
              head_sha: pr.head.sha,
              status: "pending",
              triggered_by: payload.action,
            })
            .returning()
  
          // ENQUEUE JOB
          const job = await prAnalysisQueue.add("analyze-pr", {
            reviewId: review?.id as string,
            repositoryId,
            prNumber: pr.number,
            installationId: payload.installation.id,
            owner: payload.repository.owner.login,
            repo: payload.repository.name,
            headSha: pr.head.sha,
          })
  
          console.log("Job queued:", job.id)
  
          // STORE JOB
          await tx.insert(jobs).values({
            bull_job_id: job.id!,
            review_id: review?.id as string,
            status: "waiting",
          })
  
          return { reviewId: review?.id }
        })
  
        // MARK WEBHOOK PROCESSED
        await db
          .update(webhookEvents)
          .set({ processedAt: new Date() })
          .where(eq(webhookEvents.deliveryId, deliveryId))
  
        return c.json({ queued: true, reviewId: result.reviewId })
      }
  
      // -------------------------
      // 5. INSTALLATION CREATED
      // -------------------------
      if (event === "installation" && payload.action === "created") {
        const repos = payload.repositories || []
  
        if (repos.length > 0) {
          const rows = repos.map((r: any) => ({
            githubRepoId: r.id,
            owner: r.owner?.login || payload.sender?.login,
            name: r.name,
            installationId: payload.installation.id,
            is_active: true,
          }))
  
          await db.insert(repositories)
            .values(rows)
            .onConflictDoUpdate({
              target: repositories.githubRepoId,
              set: {
                is_active: true,
                updatedAt: new Date(),
              },
            })
        }
  
        return c.json({ installation: "created" })
      }
  
      // -------------------------
      // 6. INSTALLATION DELETED
      // -------------------------
      if (event === "installation" && payload.action === "deleted") {
        await db.update(repositories)
          .set({ is_active: false, updatedAt: new Date() })
          .where(eq(repositories.installationId, payload.installation.id))
  
        return c.json({ installation: "deleted" })
      }
  
      // -------------------------
      // 7. REPOS ADDED
      // -------------------------
      if (event === "installation_repositories" && payload.action === "added") {
        const repos = payload.repositories_added || []
  
        if (repos.length > 0) {
          const rows = repos.map((r: any) => ({
            githubRepoId: r.id,
            owner: r.owner?.login || payload.sender?.login,
            name: r.name,
            installationId: payload.installation.id,
            is_active: true,
          }))
  
          await db.insert(repositories)
            .values(rows)
            .onConflictDoUpdate({
              target: repositories.githubRepoId,
              set: {
                is_active: true,
                updatedAt: new Date(),
              },
            })
        }
  
        return c.json({ repos: "added" })
      }
  
      // -------------------------
      // 8. REPOS REMOVED
      // -------------------------
      if (event === "installation_repositories" && payload.action === "removed") {
        const repoIds = (payload.repositories_removed || []).map(
          (r: any) => r.id
        )
  
        if (repoIds.length > 0) {
          await db.update(repositories)
            .set({ is_active: false, updatedAt: new Date() })
            .where(inArray(repositories.githubRepoId, repoIds))
        }
  
        return c.json({ repos: "removed" })
      }
  
      return c.json({ ignored: true })
    } catch (err) {
      console.error("Webhook error:", err)
      return c.json({ error: "Internal server error" }, 500)
    }
  })

app.get("/health", (c) => {
  return c.text("GET/ health");
});

export default {
  port: 3001,
  fetch: app.fetch,
};
