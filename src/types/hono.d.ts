declare module 'hono' {
  interface ContextVariableMap {
    validated: {
      body?: any;
      params?: Record<string, string>;
      query?: Record<string, string>;
    };
  }
}