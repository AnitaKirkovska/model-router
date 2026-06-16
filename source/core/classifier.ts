import type { Category, Classification } from "./types.js";

// ─── Keyword signals per category ─────────────────────────────────────────────

const SIGNALS: Record<Category, string[]> = {
  deep: [
    "write", "draft", "implement", "build", "code", "debug", "refactor",
    "design", "architecture", "report", "essay", "comprehensive",
    "in-depth", "in depth", "analyze", "analysis", "deep dive",
    "detailed", "compare", "comparison", "review", "step by step",
    "explain how", "walk me through", "plan out", "strategy",
  ],
  research: [
    "research", "find", "search", "look up", "lookup", "what is",
    "who is", "tell me about", "stock", "ticker", "price", "company",
    "sector", "market", "industry", "news", "latest", "recent",
    "show me", "pull up", "check", "how is", "how's", "investing",
    "summarize", "summary",
  ],
  chat: [
    "thanks", "thank you", "ok", "okay", "sure", "yes", "no",
    "hey", "hi", "hello", "quick", "remind", "schedule", "add",
    "remove", "when", "where", "who", "help", "got it", "cool",
  ],
};

/** Classify a message into a task category using keyword + length heuristics. */
export function classify(message: string): Classification {
  const lower = message.toLowerCase();
  const scores: Record<Category, number> = { chat: 0, research: 0, deep: 0 };

  for (const cat of Object.keys(SIGNALS) as Category[]) {
    for (const kw of SIGNALS[cat]) {
      if (lower.includes(kw)) scores[cat] += 1;
    }
  }

  const wordCount = message.trim().split(/\s+/).filter(Boolean).length;
  // Short messages lean chat; long messages lean deep.
  if (wordCount <= 5) scores.chat += 1;
  if (wordCount >= 30) scores.deep += 1;

  // Tie-break priority: deep > research > chat.
  const order: Category[] = ["deep", "research", "chat"];
  const category = order.reduce((a, b) => (scores[a] >= scores[b] ? a : b));

  // Confidence: margin between winner and runner-up, normalized.
  const sorted = order.map((c) => scores[c]).sort((a, b) => b - a);
  const top = sorted[0] ?? 0;
  const second = sorted[1] ?? 0;
  const confidence = top === 0 ? 0.34 : Math.min(1, (top - second + 1) / (top + 1));

  return { category, scores, wordCount, confidence };
}
