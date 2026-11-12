const DEFAULT_MUTATION_RETRY_LIMIT = 2;

/**
 * Serializes one external mutation across model loops and provider fallbacks.
 * A failed mutation gets one real retry; after a success, later calls reuse the
 * confirmed result instead of changing external state again.
 */
export function createMutationExecutionGuard(
  maxAttempts = DEFAULT_MUTATION_RETRY_LIMIT,
) {
  let attempts = 0;
  let hasSuccessfulResult = false;
  let successfulResult: unknown;
  let inFlight: Promise<unknown> | undefined;

  return async function executeGuarded<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    if (hasSuccessfulResult) return successfulResult as T;
    if (inFlight) return inFlight as Promise<T>;
    if (attempts >= maxAttempts) {
      throw new Error(
        `Connected-app mutation retry limit reached after ${maxAttempts} real execution attempts`,
      );
    }

    attempts += 1;
    inFlight = operation()
      .then((result) => {
        successfulResult = result;
        hasSuccessfulResult = true;
        return result;
      })
      .finally(() => {
        inFlight = undefined;
      });

    return inFlight as Promise<T>;
  };
}
