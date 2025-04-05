import { wrapOpenAI } from "langsmith/wrappers";
import { OpenAI } from "openai";

// Initialize OpenAI client with or without LangSmith wrapper based on environment variable
export const openAIClient = process.env.ENABLE_LANGSMITH_TRACING === 'true' 
  ? wrapOpenAI(new OpenAI())
  : new OpenAI();

// Helper function to create a traceable function
export function traceable<T extends (...args: any[]) => any>(
  fn: T,
  name?: string
): T {
  // If LangSmith tracing is disabled, return the original function
  if (process.env.ENABLE_LANGSMITH_TRACING !== 'true') {
    return fn;
  }
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