// Simple logger that avoids logging sensitive information
export const logger = {
  info: (message: string, meta?: Record<string, any>) => {
    if (process.env.NODE_ENV !== 'test') {
      console.error(JSON.stringify({
        level: 'info',
        message,
        ...sanitizeMeta(meta),
        timestamp: new Date().toISOString(),
      }));
    }
  },

  error: (message: string, meta?: Record<string, any>) => {
    if (process.env.NODE_ENV !== 'test') {
      console.error(JSON.stringify({
        level: 'error',
        message,
        ...sanitizeMeta(meta),
        timestamp: new Date().toISOString(),
      }));
    }
  },

  debug: (message: string, meta?: Record<string, any>) => {
    if (process.env.DEBUG && process.env.NODE_ENV !== 'test') {
      console.error(JSON.stringify({
        level: 'debug',
        message,
        ...sanitizeMeta(meta),
        timestamp: new Date().toISOString(),
      }));
    }
  },
};

function sanitizeMeta(meta?: Record<string, any>): Record<string, any> {
  if (!meta) return {};
  
  const sanitized: Record<string, any> = {};
  const sensitiveKeys = ['password', 'secret', 'token', 'auth', 'key', 'credential'];
  
  for (const [key, value] of Object.entries(meta)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeMeta(value);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}