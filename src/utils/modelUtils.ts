/**
 * Utility functions for model selection and API call cost calculation.
 */

/**
 * Selects the most suitable model based on criteria (e.g., cost, performance, user role).
 * @param models - List of available models.
 * @param inputTokens - Number of input tokens.
 * @param outputTokens - Number of output tokens.
 * @param isProUser - Whether the user is a pro owner.
 * @param useCache - Whether to use cached input costs.
 * @returns The selected model object.
 */
export function selectModel(
    models: readonly any[],
    inputTokens: number,
    outputTokens: number,
    isProUser: boolean,
    useCache: boolean
): any {
    // Filter models based on visibility and user role
    const availableModels = models.filter(
        model => model.listInHelp || (isProUser && model.listForProOwners)
    );

    // If no models are available, throw an error
    if (!availableModels.length) {
        throw new Error('No available models for the user role');
    }

    // Select the cheapest model that meets minimum performance
    return availableModels.reduce((cheapest, current) => {
        const currentCost = calculateCost(current, inputTokens, outputTokens, useCache);
        const cheapestCost = calculateCost(cheapest, inputTokens, outputTokens, useCache);
        return currentCost < cheapestCost ? current : cheapest;
    }, availableModels[0]);
}

/**
 * Calculates the total cost of an API call based on the model and token usage.
 * @param model - The model to calculate cost for.
 * @param inputTokens - Number of input tokens.
 * @param outputTokens - Number of output tokens.
 * @param useCache - Whether to use cached input costs.
 * @returns The total cost in currency units.
 */
export function calculateCost(
    model: any,
    inputTokens: number,
    outputTokens: number,
    useCache: boolean
): number {
    // Use cached input cost if available and requested
    const inputCost = useCache && model.cachedInputCost ? model.cachedInputCost : model.inputCost || 0;
    const outputCost = model.outputCost || 0;
    const taxMultiplier = model.taxMultiplier || 1;

    // Calculate total cost: (input cost * input tokens) + (output cost * output tokens) * tax
    const totalCost = ((inputCost * inputTokens) + (outputCost * outputTokens)) * taxMultiplier;

    // Add cache write cost if applicable
    const cacheWriteCost = model.cacheWriteCost ? model.cacheWriteCost : 0;
    return totalCost + (useCache ? cacheWriteCost : 0);
}