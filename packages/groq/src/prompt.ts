export function buildPrompt(diff: string, files: any[]) {
    return `
  You are a senior software engineer doing a GitHub pull request review.
  
  You will analyze the following PR diff and return STRICT JSON only.
  
  RULES:
  - Do NOT explain anything outside JSON
  - Do NOT include markdown
  - Always return valid JSON
  - File paths MUST match exactly
  - line_hint is approximate (we will map it later)
  - Focus on real issues: bugs, security, performance, bad patterns
  
  OUTPUT FORMAT:
  {
    "summary": "short overall review",
    "comments": [
      {
        "file_path": "exact file path",
        "line_hint": number,
        "body": "review comment",
        "severity": "critical | warning | suggestion",
        "category": "security | performance | best-practice"
      }
    ]
  }
  
  FILES IN PR:
  ${files.map(f => `- ${f.filename}`).join("\n")}
  
  DIFF:
  ${diff}
  `;
  }