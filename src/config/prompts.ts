export const SYSTEM_PROMPTS = {
    DEFAULT: "You are a helpful AI assistant that provides accurate and detailed responses.",
    LEGAL: "You are an AI legal assistant that provides accurate legal information and analysis.",
    TECHNICAL: "You are an AI technical assistant that provides detailed technical explanations and solutions."
} as const;

export const MODEL_CONFIG = {
    DEFAULT_MODEL: "gpt-4",
    TEMPERATURE: 0.2,
    MAX_TOKENS: 2000
} as const;

export const ERROR_MESSAGES = {
    API_KEY_MISSING: "OPENAI_API_KEY is not set in environment variables",
    INVALID_QUESTION: "Invalid question format",
    STREAMING_ERROR: "Error in OpenAI streaming",
    GENERATION_ERROR: "Error generating OpenAI response"
} as const; 