export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogRecord = Record<string, unknown> & { level: LogLevel; event: string; at: string };

const secretKeys = /token|secret|password|authorization|api[_-]?key/i;
const piiKeys = /phone|address|recipient|customer_name/i;

export function redact(value: unknown, key = ""): unknown {
  if (secretKeys.test(key)) return "[REDACTED]";
  if (piiKeys.test(key)) return "[PII]";
  if (typeof value === "string") {
    return value
      .replace(/\b0\d{9}\b/g, (phone) => `${phone.slice(0, 3)}****${phone.slice(-3)}`)
      .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]");
  }
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [childKey, redact(child, childKey)]),
    );
  }
  return value;
}

export class StructuredLogger {
  constructor(private readonly sink: (line: string) => void = console.log) {}

  log(level: LogLevel, event: string, context: Record<string, unknown> = {}): void {
    const record: LogRecord = {
      level,
      event,
      at: new Date().toISOString(),
      ...(redact(context) as Record<string, unknown>),
    };
    this.sink(JSON.stringify(record));
  }
}
