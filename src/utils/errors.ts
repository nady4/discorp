export class DiscorpError extends Error {
  constructor(
    message: string,
    public readonly userMessage?: string,
  ) {
    super(message);
    this.name = "DiscorpError";
  }
}

/** Error raised when the cost guard blocks an execution (budget, limits, sleep). */
export class CostGuardError extends DiscorpError {
  constructor(message: string) {
    super(message, `⛔ ${message}`);
    this.name = "CostGuardError";
  }
}

/** Error raised when an agent execution exceeds safety limits. */
export class ExecutionLimitError extends DiscorpError {
  constructor(message: string) {
    super(message, `⚠️ ${message}`);
    this.name = "ExecutionLimitError";
  }
}

/** Wrap a thrown unknown value into a readable error message. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * User-facing error text: the curated message for DiscorpError, or a generic
 * message for anything else (never leaks provider/database internals).
 */
export function userMessage(err: unknown): string {
  if (err instanceof DiscorpError) return err.userMessage ?? err.message;
  return "Something went wrong. Please try again.";
}
