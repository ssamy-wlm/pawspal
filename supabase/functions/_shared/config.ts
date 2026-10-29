// How functions read settings. In Deno this is Deno.env; tests pass a plain object.
export interface Env {
  get(name: string): string | undefined;
}

export function envFrom(obj: Record<string, string | undefined>): Env {
  return { get: (name) => obj[name] };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}
