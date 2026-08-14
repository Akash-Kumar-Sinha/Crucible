import pino from "pino";

const isDev =
  process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test";
const logLevel =
  process.env.LOG_LEVEL ??
  (process.env.NODE_ENV === "test" ? "silent" : isDev ? "debug" : "info");

export const logger = pino({
  level: logLevel,
  transport:
    isDev && process.env.PINO_PRETTY !== "false"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss.l",
            ignore: "pid,hostname",
            singleLine: false,
          },
        }
      : undefined,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Creates a child logger with session correlation context
 */
export function createSessionLogger(sessionId: string) {
  return logger.child({ sessionId });
}

/**
 * Creates a child logger with turn correlation context
 */
export function createTurnLogger(sessionId: string, turnId: number) {
  return logger.child({ sessionId, turnId });
}

/**
 * Creates a child logger for individual tool executions
 */
export function createToolLogger(
  sessionId: string,
  turnId: number,
  toolName: string,
  callId: string,
) {
  return logger.child({
    sessionId,
    turnId,
    tool: toolName,
    callId,
  });
}
