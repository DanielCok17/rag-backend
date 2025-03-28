import { wrapOpenAI } from "langsmith/wrappers";
import { OpenAI } from "openai";

// Initialize OpenAI client with LangSmith wrapper
export const openAIClient = wrapOpenAI(new OpenAI());

// Helper function to create a traceable function
export function traceable<T extends (...args: any[]) => any>(
  fn: T,
  name?: string
): T {
  return fn as T;
}

// Example usage:
/*
import { traceable } from './utils/langsmith';

const myFunction = traceable(async (input: string) => {
  // Your function implementation
  return await openAIClient.chat.completions.create({
    messages: [{ role: "user", content: input }],
    model: "gpt-4o-mini",
  });
});
*/ 