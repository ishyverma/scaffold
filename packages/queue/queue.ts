import { Queue } from "bullmq"
import { connection } from "./connection"
import type { PrAnalysisJob } from "./types"

export const PR_ANALYSIS_QUEUE = "pr-analysis"

export const prAnalysisQueue = new Queue<PrAnalysisJob>(
  PR_ANALYSIS_QUEUE,
  {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    },
  }
)