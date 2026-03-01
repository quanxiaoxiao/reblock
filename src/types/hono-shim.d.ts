// Global type declaration to let TypeScript know about Hono types
declare module 'hono' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export class Hono<E = any, S = any, BasePath extends string = any> {
    use(...middleware: any[]): this;
    route(path: string, app?: any): this;
    get(path: string, ...handlers: any[]): this;
    post(path: string, ...handlers: any[]): this;
    put(path: string, ...handlers: any[]): this;
    delete(path: string, ...handlers: any[]): this;
    patch(path: string, ...handlers: any[]): this;
    on(method: string | string[], path: string, ...handlers: any[]): this;
    onError(handler: (err: Error, c: any) => any): this;
    notFound(handler: (c: any) => any): this;
    fire(): void;
    fetch: (request: Request, env?: E, executionCtx?: any) => Response | Promise<Response>;
  }
  
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export type Context<E = any, P extends string = any, S = any> = any;
  export type Next = () => Promise<void>;
}

declare module 'hono/logger' {
  export const logger: () => any;
}