export type PrAnalysisJob = {
    reviewId: string
    repositoryId: string
    prNumber: number
    installationId: number
    owner: string
    repo: string
    headSha: string
}