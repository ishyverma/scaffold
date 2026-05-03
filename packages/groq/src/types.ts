export type AIComment = {
  file_path: string;
  line_hint: number;
  body: string;
  severity: "critical" | "warning" | "suggestion";
  category: "security" | "performance" | "best-practice";
};

export type AIReviewResult = {
  summary: string;
  comments: AIComment[];
};
