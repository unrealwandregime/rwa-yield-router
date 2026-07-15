import { randomUUID } from "node:crypto";

import { redactValue } from "./redaction.js";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogContext = Readonly<Record<string, unknown>>;

export interface Logger {
  child(context: LogContext): Logger;
  debug(event: string, context?: LogContext): void;
  info(event: string, context?: LogContext): void;
  warn(event: string, context?: LogContext): void;
  error(event: string, context?: LogContext): void;
}

export interface StructuredLoggerOptions {
  readonly service: string;
  readonly environment: string;
  readonly minimumLevel?: LogLevel;
  readonly write?: (line: string) => void;
  readonly context?: LogContext;
  readonly now?: () => Date;
}

const levelOrder: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export function createCorrelationId(): string {
  return randomUUID();
}

export function createStructuredLogger(options: StructuredLoggerOptions): Logger {
  const minimumLevel = options.minimumLevel ?? "info";
  const write = options.write ?? ((line: string) => process.stdout.write(line + "\n"));
  const now = options.now ?? (() => new Date());
  const baseContext = options.context ?? {};

  const emit = (level: LogLevel, event: string, context: LogContext = {}): void => {
    if (levelOrder[level] < levelOrder[minimumLevel]) {
      return;
    }
    const record = redactValue({
      timestamp: now().toISOString(),
      severity: level,
      service: options.service,
      environment: options.environment,
      event,
      ...baseContext,
      ...context
    });
    write(JSON.stringify(record));
  };

  return {
    child(context) {
      return createStructuredLogger({
        ...options,
        context: {
          ...baseContext,
          ...context
        },
        minimumLevel,
        now,
        write
      });
    },
    debug(event, context) {
      emit("debug", event, context);
    },
    info(event, context) {
      emit("info", event, context);
    },
    warn(event, context) {
      emit("warn", event, context);
    },
    error(event, context) {
      emit("error", event, context);
    }
  };
}
