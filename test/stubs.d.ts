// Minimal ambient stubs for Next.js modules the generated code imports.
// axios, @tanstack/react-query, react and js-cookie are type-checked against their real typings
// (devDependencies); Next.js is stubbed to keep the install small.
declare module 'server-only' {}
declare module 'next/server' {
  export class NextResponse extends Response {
    static json(body: unknown, init?: ResponseInit): NextResponse;
  }
}
declare module 'next/headers' {
  export function cookies(): Promise<{ get(name: string): { value: string } | undefined }>;
}
declare module 'next' {
  import type { IncomingMessage, ServerResponse } from 'node:http';
  export interface NextApiRequest extends IncomingMessage {
    query: Partial<Record<string, string | string[]>>;
    cookies: Partial<Record<string, string>>;
    body: any;
  }
  export interface NextApiResponse<T = any> extends ServerResponse {
    status(code: number): NextApiResponse<T>;
    json(body: T): void;
  }
}

// Vite projects type import.meta.env through vite/client
interface ImportMeta { readonly env: Record<string, string | undefined> }
