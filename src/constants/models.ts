/**
 * Constants file containing the list of available models with their properties.
 */

// Placeholder for tax multiplier (to be replaced with actual value or config)
const OPENROUTER_TAX_MULTIPLIER = 1;

/**
 * List of available models with their pricing and visibility properties.
 */
export const MODELS = [
    { name: "MiniMax", listInHelp: true, id: "MiniMax-Text-01", inputCost: 0.2, outputCost: 1.1 },
    { name: "DeepSeek-deepinfra.com", listInHelp: false, listForProOwners: false, id: "deepseek-ai/DeepSeek-V3", inputCost: 0.49, cachedInputCost: 0.49, outputCost: 0.89, taxMultiplier: 1 },
    { name: "DeepSeek-fireworks.ai", listInHelp: true, listForProOwners: true, id: "accounts/fireworks/models/deepseek-v3", inputCost: 0.75, cachedInputCost: 0.75, outputCost: 3, taxMultiplier: 1 },
    { name: "deepseek.com", listInHelp: false, listForProOwners: false, id: "deepseek-chat", inputCost: 0.27, cachedInputCost: 0.07, outputCost: 1.1 },
    { name: "deepseek.com R", listInHelp: false, listForProOwners: false, id: "deepseek-reasoner", inputCost: 0.55, cachedInputCost: 0.14, outputCost: 2.19 },
    { name: "4o", listInHelp: true, id: "gpt-4o", inputCost: 2.5, cachedInputCost: 1.25, outputCost: 10 },
    { name: "4olatest", listInHelp: true, id: "chatgpt-4o-latest", inputCost: 2.5, cachedInputCost: 1.25, outputCost: 10 },
    { name: "4o1120", listInHelp: true, id: "gpt-4o-2024-11-20", inputCost: 2.5, cachedInputCost: 1.25, outputCost: 10 },
    { name: "4o0806", listInHelp: false, id: "gpt-4o-2024-08-06", inputCost: 2.5, cachedInputCost: 1.25, outputCost: 10 },
    { name: "4omini", listInHelp: true, id: "gpt-4o-mini", inputCost: 0.15, cachedInputCost: 0.075, outputCost: 0.6 },
    { name: "o1mini", listInHelp: false, id: "o1-mini", inputCost: 1.1, cachedInputCost: 0.55, outputCost: 4.4 },
    { name: "o3mini", listInHelp: true, id: "o3-mini", inputCost: 1.1, cachedInputCost: 0.55, outputCost: 4.4 },
    { name: "4Turbo", listInHelp: true, id: "gpt-4-turbo", inputCost: 10, outputCost: 30 },
    {
        name: "Sonnet37Anthropic",
        listInHelp: false,
        listForProOwners: false,
        id: "claude-3-7-sonnet-20250219",
        inputCost: 3,
        outputCost: 15,
        cachedInputCost: 0.3,
        cacheWriteCost: 3.75
    },
    {
        name: "Sonnet37OpenRouter",
        listInHelp: true,
        listForProOwners: true,
        id: "anthropic/claude-3.7-sonnet",
        inputCost: 3,
        outputCost: 15,
        cachedInputCost: 0.3,
        cacheWriteCost: 3.75,
        taxMultiplier: OPENROUTER_TAX_MULTIPLIER
    },
    {
        name: "Haiku35OpenRouter",
        listInHelp: true,
        listForProOwners: true,
        id: "anthropic/claude-3.5-haiku",
        inputCost: 0.8,
        outputCost: 4,
        cachedInputCost: 0.08,
        cacheWriteCost: 1,
        taxMultiplier: OPENROUTER_TAX_MULTIPLIER
    },
    {
        name: "SonnetAnthropic",
        listInHelp: false,
        listForProOwners: false,
        id: "claude-3-5-sonnet-20241022",
        inputCost: 3,
        outputCost: 15,
        cachedInputCost: 0.3,
        cacheWriteCost: 3.75
    },
    {
        name: "Sonnet35OpenRouter",
        listInHelp: true,
        listForProOwners: true,
        id: "anthropic/claude-3.5-sonnet",
        inputCost: 3,
        outputCost: 15,
        cachedInputCost: 0.3,
        cacheWriteCost: 3.75,
        taxMultiplier: OPENROUTER_TAX_MULTIPLIER
    },
    {
        name: "Sonnet35-0620-OpenRouter",
        listInHelp: false,
        listForProOwners: false,
        id: "anthropic/claude-3.5-sonnet-20240620",
        inputCost: 3,
        outputCost: 15,
        cachedInputCost: 0.3,
        cacheWriteCost: 3.75,
        taxMultiplier: OPENROUTER_TAX_MULTIPLIER
    },
    {
        name: "4o-OpenRouter",
        listInHelp: false,
        listForProOwners: false,
        id: "openai/gpt-4o-2024-08-06",
        inputCost: 2.5,
        outputCost: 10,
        cachedInputCost: 1.25,
        taxMultiplier: OPENROUTER_TAX_MULTIPLIER
    },
    {
        name: "gpt45OpenRouter",
        listInHelp: true,
        listForProOwners: false,
        id: "openai/gpt-4.5-preview",
        inputCost: 75,
        outputCost: 150,
        cachedInputCost: 37.5,
        taxMultiplier: OPENROUTER_TAX_MULTIPLIER
    },
    {
        name: "4o-mini-OpenRouter",
        listInHelp: false,
        listForProOwners: false,
        id: "openai/gpt-4o-mini-2024-07-18",
        inputCost: 0.15,
        outputCost: 0.6,
        cachedInputCost: 0.075,
        taxMultiplier: OPENROUTER_TAX_MULTIPLIER
    },
    {
        name: "SonnetLatest",
        listInHelp: false,
        id: "claude-3-5-sonnet-latest",
        inputCost: 3,
        outputCost: 15,
        cachedInputCost: 0.3,
        cacheWriteCost: 3.75
    },
    {
        name: "Sonnet-20240620",
        listInHelp: false,
        id: "claude-3-5-sonnet-20240620",
        inputCost: 3,
        outputCost: 15,
        cachedInputCost: 0.3,
        cacheWriteCost: 3.75
    },
    { name: "Opus", listInHelp: true, id: "claude-3-opus-20240229", inputCost: 15, outputCost: 75 },
    { name: "Haiku", listInHelp: false, id: "claude-3-haiku-20240307", inputCost: 0.25, outputCost: 1.25 },
    {
        name: "Haiku35",
        listInHelp: true,
        id: "claude-3-5-haiku-20241022",
        inputCost: 1,
        outputCost: 5,
        cachedInputCost: 0.1,
        cacheWriteCost: 1.25
    },
    { name: "Llama", listInHelp: false, id: "meta-llama/llama-3.1-405b-instruct", inputCost: 2.7, outputCost: 2.7 },
    { name: "Mistral", listInHelp: false, id: "mistral-large-latest", inputCost: 3, outputCost: 9 },
    { name: "Gemini15", listInHelp: true, id: "google/gemini-pro-1.5", inputCost: 1.25, outputCost: 5, taxMultiplier: OPENROUTER_TAX_MULTIPLIER },
    { name: "Gemini20flashExpFree-openrouter", listInHelp: false, id: "google/gemini-2.0-flash-exp:free", inputCost: 0, outputCost: 0, taxMultiplier: OPENROUTER_TAX_MULTIPLIER },
    { name: "Gemini20flashGoogleApi", listInHelp: true, id: "gemini-2.0-flash", inputCost: 0.1, outputCost: 0.4 },
    { name: "Gemini20flashGoogleApiFree", listInHelp: false, id: "gemini-2.0-flash-exp", inputCost: 0, outputCost: 0 },
    { name: "whisper", listInHelp: false, id: "whisper", inputCost: 0.006 },
    { name: "OpenAI TTS", listInHelp: false, id: "tts-1", inputCost: 15 },
    { name: "OpenAI embedding", listInHelp: false, id: "text-embedding-3-large", inputCost: 0.13 },
    { name: "OpenAI embedding ada", listInHelp: false, id: "text-embedding-ada-002", inputCost: 0.1 },
    { name: "Perplexity small", listInHelp: false, id: "llama-3.1-sonar-small-128k-online", inputCost: 0.20 },
    { name: "Perplexity large", listInHelp: false, id: "llama-3.1-sonar-large-128k-online", inputCost: 1 },
    { name: "Perplexity sonar", listInHelp: false, id: "sonar", inputCost: 1, outputCost: 1, taxMultiplier: 1 },
    { name: "Perplexity sonar pro", listInHelp: false, id: "sonar-pro", inputCost: 3, outputCost: 15, taxMultiplier: 1 },
    { name: "palmyrax004", listInHelp: true, id: "palmyra-x-004", inputCost: 5, outputCost: 12 },
] as const;

/**
 * Type definition for a model object.
 */
export type Model = typeof MODELS[number];