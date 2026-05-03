import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";

import dotenv from "dotenv";
import path from "path";

dotenv.config({
  path: path.join(__dirname, "../../.env"),
});

// -----------------------------
// CONFIG
// -----------------------------
const appId = Number(process.env.GITHUB_APP_ID!);
const privateKey = Buffer.from(
  process.env.GITHUB_PRIVATE_KEY!,
  "base64",
).toString("utf-8");

// -----------------------------
// TOKEN CACHE (in-memory)
// -----------------------------
type TokenCacheEntry = {
  token: string;
  expiresAt: number;
};

const installationTokenCache = new Map<number, TokenCacheEntry>();

// 50 min TTL (in ms)
const TOKEN_TTL = 50 * 60 * 1000;

// -----------------------------
// Get Installation Token
// -----------------------------
export async function getInstallationToken(
  installationId: number,
): Promise<string> {
  const now = Date.now();

  const cached = installationTokenCache.get(installationId);

  if (cached && cached.expiresAt > now) {
    return cached.token;
  }

  // Create app auth instance
  const auth = createAppAuth({
    appId,
    privateKey,
  });

  // Generate fresh token
  const { token } = await auth({
    type: "installation",
    installationId,
  });

  // Cache it
  installationTokenCache.set(installationId, {
    token,
    expiresAt: now + TOKEN_TTL,
  });

  return token;
}

// -----------------------------
// Helper: get authed Octokit
// -----------------------------
async function getClient(installationId: number) {
  const token = await getInstallationToken(installationId);

  return new Octokit({
    auth: token,
  });
}

// -----------------------------
// Get PR Diff
// -----------------------------
export async function getDiff(
  owner: string,
  repo: string,
  prNumber: number,
  installationId: number,
): Promise<string> {
  const octokit = await getClient(installationId);

  const res = await octokit.request(
    "GET /repos/{owner}/{repo}/pulls/{pull_number}",
    {
      owner,
      repo,
      pull_number: prNumber,
      headers: {
        accept: "application/vnd.github.v3.diff",
      },
    },
  );

  return res.data as unknown as string;
}

// -----------------------------
// Post Review
// -----------------------------
type ReviewInput = {
  body: string;
  event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
};

type InlineComment = {
    path: string;
    line: number;
    body: string;
  };
  
  export async function postReviewWithComments(
    owner: string,
    repo: string,
    prNumber: number,
    installationId: number,
    review: {
      body: string;
      event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
      comments: InlineComment[];
    },
  ) {
    const octokit = await getClient(installationId);
  
    return await octokit.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      body: review.body,
      event: review.event,
      comments: review.comments.map((c) => ({
        path: c.path,
        body: c.body,
        side: "RIGHT",
        line: c.line
      })),
    });
  }

// Replace extractPositionFromPatch entirely
export function findDiffLine(
    patch: string | undefined,
    targetLine: number,
  ): number | null {
    if (!patch) return null;
  
    const lines = patch.split("\n");
    let currentLine = 0;
    const diffLines: number[] = []; 
  
    for (const line of lines) {
      if (line.startsWith("@@")) {
        const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
        if (match) {
          currentLine = parseInt(match[1] as string, 10) - 1;
        }
        continue;
      }
  
      if (line.startsWith("-")) {
        continue;
      }
  
      if (line.startsWith("+") || line.startsWith(" ")) {
        currentLine++;
        diffLines.push(currentLine);
      }
    }
  
    if (diffLines.length === 0) return null;
  
    if (diffLines.includes(targetLine)) return targetLine;
  
    return diffLines.reduce((prev, curr) =>
      Math.abs(curr - targetLine) < Math.abs(prev - targetLine) ? curr : prev,
    );
  }

export async function getPRFiles(
    owner: string,
    repo: string,
    prNumber: number,
    installationId: number
  ) {
    const octokit = await getClient(installationId);
  
    const res = await octokit.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
    });
  
    return res.data;
}

export async function postInlineComment({
    owner,
    repo,
    prNumber,
    installationId,
    headSha,
    comment,
  }: any) {
    const octokit = await getClient(installationId);
  
    return octokit.pulls.createReviewComment({
      owner,
      repo,
      pull_number: prNumber,
      commit_id: headSha,
      path: comment.file_path,
      body: comment.body,
      line: comment.line_hint,
    });
  }

  export function extractPositionFromPatch(
    patch: string | undefined,
    targetLine: number,
  ): number | null {
    if (!patch) return null;
  
    const lines = patch.split("\n");
    let position = 0;      
    let currentLine = 0;   
  
    for (const line of lines) {
      if (line.startsWith("@@")) {
        const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
        if (match) {
          currentLine = parseInt(match[1] as string, 10) - 1; 
        }
        position++;
        continue;
      }
  
      if (line.startsWith("-")) {
        position++;
        continue;
      }
  
      position++;
      currentLine++;
  
      if (currentLine === targetLine) {
        return position;
      }
    }
  
    return null;
}

export async function postReview(
  owner: string,
  repo: string,
  prNumber: number,
  installationId: number,
  review: ReviewInput,
) {
  const octokit = await getClient(installationId);

  return await octokit.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    body: review.body,
    event: review.event,
  });
}
