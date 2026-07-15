export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  readonly failureThreshold: number;
  readonly recoveryTimeoutMs: number;
  readonly successThreshold?: number;
  readonly now?: () => number;
}

export class CircuitOpenError extends Error {
  public readonly retryAfterMs: number;

  public constructor(retryAfterMs: number) {
    super("CIRCUIT_OPEN");
    this.name = "CircuitOpenError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class CircuitBreaker {
  private failureCount = 0;
  private successCount = 0;
  private openedAt: number | null = null;
  private halfOpenRequestInFlight = false;
  private readonly now: () => number;
  private readonly successThreshold: number;

  public constructor(private readonly options: CircuitBreakerOptions) {
    if (
      !Number.isInteger(options.failureThreshold) ||
      options.failureThreshold <= 0 ||
      !Number.isInteger(options.recoveryTimeoutMs) ||
      options.recoveryTimeoutMs <= 0
    ) {
      throw new RangeError("Circuit breaker thresholds must be positive integers");
    }
    this.successThreshold = options.successThreshold ?? 1;
    this.now = options.now ?? Date.now;
  }

  public state(): CircuitState {
    if (this.openedAt === null) {
      return "CLOSED";
    }
    return this.now() - this.openedAt >= this.options.recoveryTimeoutMs ? "HALF_OPEN" : "OPEN";
  }

  public async execute<T>(operation: () => Promise<T>): Promise<T> {
    const state = this.state();
    if (state === "OPEN") {
      const elapsed = this.now() - (this.openedAt ?? this.now());
      throw new CircuitOpenError(Math.max(0, this.options.recoveryTimeoutMs - elapsed));
    }
    if (state === "HALF_OPEN" && this.halfOpenRequestInFlight) {
      throw new CircuitOpenError(this.options.recoveryTimeoutMs);
    }
    if (state === "HALF_OPEN") {
      this.halfOpenRequestInFlight = true;
    }

    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    } finally {
      this.halfOpenRequestInFlight = false;
    }
  }

  private recordSuccess(): void {
    if (this.state() === "HALF_OPEN") {
      this.successCount += 1;
      if (this.successCount >= this.successThreshold) {
        this.failureCount = 0;
        this.successCount = 0;
        this.openedAt = null;
      }
      return;
    }
    this.failureCount = 0;
  }

  private recordFailure(): void {
    this.successCount = 0;
    this.failureCount += 1;
    if (this.state() === "HALF_OPEN" || this.failureCount >= this.options.failureThreshold) {
      this.openedAt = this.now();
    }
  }
}
