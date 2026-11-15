import { Injectable, type LoggerService } from '@nestjs/common';
import { sanitizeObject, sanitizeString } from './log-sanitizer';
import { OBSERVABILITY } from './observability.config';

interface LogEntry {
  timestamp: string;
  level: string;
  service: string;
  environment: string;
  version: string;
  message: string;
  context?: string;
  [key: string]: unknown;
}

@Injectable()
export class JsonLoggerService implements LoggerService {
  private formatLog(
    level: string,
    message: string,
    context?: string,
    meta?: Record<string, unknown>,
  ): string {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: OBSERVABILITY.service,
      environment: OBSERVABILITY.env,
      version: OBSERVABILITY.version,
      message: sanitizeString(message),
    };

    if (context) entry.context = context;
    if (meta) Object.assign(entry, sanitizeObject(meta));

    return JSON.stringify(entry);
  }

  log(message: string, context?: string): void {
    console.log(this.formatLog('info', message, context));
  }

  error(message: string, trace?: string, context?: string): void {
    console.error(
      this.formatLog(
        'error',
        message,
        context,
        trace ? { stack: trace } : undefined,
      ),
    );
  }

  warn(message: string, context?: string): void {
    console.warn(this.formatLog('warn', message, context));
  }

  debug(message: string, context?: string): void {
    console.debug(this.formatLog('debug', message, context));
  }

  verbose(message: string, context?: string): void {
    console.log(this.formatLog('verbose', message, context));
  }
}
