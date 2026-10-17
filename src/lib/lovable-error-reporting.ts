interface ErrorMetadata {
  boundary?: string;
  [key: string]: unknown;
}

export function reportLovableError(error: Error, metadata: ErrorMetadata = {}): void {
  if (import.meta.env.DEV) {
    console.error("[lovable:error]", {
      message: error.message,
      stack: error.stack,
      ...metadata,
    });
  }
}
