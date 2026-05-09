# Scaffold - AI-Powered PR Review System

Scaffold is an AI-powered GitHub Pull Request review system that automatically analyzes PRs and posts inline code review comments using Groq AI.

## Project Structure

This is a Turborepo monorepo containing multiple apps and shared packages.

## Directory Structure

```
scaffold/
├── apps/
│   ├── web/           # Next.js frontend application
│   ├── webhook/       # Hono server for GitHub webhooks
│   └── worker/        # BullMQ worker for PR analysis
├── packages/
│   ├── db/            # Drizzle ORM with PostgreSQL
│   ├── queue/         # BullMQ queue with Redis
│   ├── groq/          # Groq AI SDK for PR analysis
│   ├── github/        # GitHub API integration with Octokit
│   ├── ui/            # Shared React UI components
│   ├── eslint-config/ # ESLint configurations
│   └── typescript-config/ # TypeScript configurations
```

## Apps

### Web
Next.js 16 frontend application running on port 3000. Currently serves as a placeholder landing page.

### Webhook
Hono-based HTTP server running on port 3001 that receives GitHub webhooks.

### Worker
BullMQ worker that processes PR analysis jobs from the queue.

## Packages

### @repo/db
Database layer using Drizzle ORM with PostgreSQL. Contains schema for:
- repositories
- webhook_events
- pull_requests
- reviews
- review_comments
- jobs

### @repo/queue
BullMQ queue implementation with Redis. Manages PR analysis job processing.

### @repo/groq
Groq AI SDK integration for analyzing PR diffs and generating review comments.

### @repo/github
GitHub API integration using Octokit and @octokit/auth-app for authenticated requests.

### @repo/ui
Shared React UI components (Button, Card, Code) used by the web app.

## Flow

### 1. Webhook Reception

GitHub sends webhooks to the webhook server when events occur:
- pull_request (opened, synchronize, reopened)
- installation (created, deleted)
- installation_repositories (added, removed)

### 2. Event Validation

The webhook server validates:
- HMAC-SHA256 signature verification
- Idempotency check (duplicate delivery detection)

### 3. Repository Resolution

When a webhook is received, the repository is created or updated in the database with:
- GitHub repository ID
- Owner and name
- Installation ID (for GitHub App authentication)
- Active status

### 4. Webhook Event Logging

Every webhook delivery is logged in the webhook_events table with:
- Delivery ID (for idempotency)
- Event type
- Action
- Repository reference
- Processed timestamp

### 5. Pull Request Event Handling

For pull_request events:
- Upserts the PR record in the database
- Creates a new review record with pending status
- Enqueues a job to the BullMQ queue

### 6. Job Processing

The worker picks up jobs and:
- Marks the review as "processing"
- Fetches the PR diff and file list from GitHub
- Sends the diff to Groq AI for analysis
- Maps AI-generated comments to actual diff line numbers
- Posts the review back to GitHub with inline comments
- Stores the comments in the database
- Marks the review as "completed"

### 7. GitHub Integration

The GitHub package handles:
- App authentication using private key
- Installation token caching
- Fetching PR diffs and files
- Posting reviews with inline comments

## System Architecture

[SPACE RESERVED FOR SYSTEM ARCHITECTURE DIAGRAM]

## Technology Stack

- **Runtime**: Bun
- **Framework**: Next.js 16, Hono
- **Database**: PostgreSQL with Drizzle ORM
- **Queue**: BullMQ with Redis
- **AI**: Groq (Llama 3.1 8B)
- **GitHub**: Octokit with GitHub App authentication
- **UI**: React 19
- **Build**: Turborepo

## Getting Started

### Prerequisites

- PostgreSQL
- Redis
- Bun
- GitHub App credentials

### Environment Variables

Create a .env file with:

```
DATABASE_URL=postgresql://postgres:password@localhost:5432/postgres
REDIS_URL=redis://localhost:6379
GROQ_API_KEY=your_groq_api_key
GITHUB_WEBHOOK_SECRET=your_webhook_secret
GITHUB_APP_ID=your_app_id
GITHUB_PRIVATE_KEY=your_base64_encoded_private_key
```

### Installation

```bash
bun install
```

### Database Setup

```bash
bun --filter @repo/db db:push
```

### Running Development

Start all apps:
```bash
bun run dev
```

Start individual apps:
```bash
bun --filter web dev      # Next.js frontend on port 3000
bun --filter @repo/webhook dev  # Webhook server on port 3001
bun --filter @repo/worker dev   # Worker (requires Redis)
```

### Building

```bash
bun run build
```

## Available Scripts

- `bun run dev` - Start all apps in development mode
- `bun run build` - Build all apps and packages
- `bun run lint` - Lint all apps and packages
- `bun run check-types` - Type check all apps and packages
- `bun run format` - Format code with Prettier