import dotenv from "dotenv"
import path from "path"

dotenv.config({
    path: path.join(__dirname, "../../../.env")
})

import Groq from "groq-sdk";
import { buildPrompt } from "./prompt";
import type { AIReviewResult } from "./types";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY!,
});

export async function analyzePR(diff: string, files: any[]): Promise<AIReviewResult> {
  const prompt = buildPrompt(diff, files);

  const res = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: [
      {
        role: "system",
        content:
          "You are a strict JSON generator. Output only valid JSON.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.2,
  });

  const content = res.choices[0]?.message.content;

  try {
    return JSON.parse(content || "{}");
  } catch (e) {
    console.error("Groq returned invalid JSON:", content);
    throw new Error("Invalid AI response");
  }
}

export * from "./prompt";
export * from "./types";