declare module 'node:test' {
  export type TestFn = () => void | Promise<void>;
  function test(name: string, fn: TestFn): Promise<void>;
  export function before(fn: TestFn): void;
  export function after(fn: TestFn): void;
  export default test;
}

declare module 'node:assert/strict' {
  function assert(value: unknown, message?: string): asserts value;
  namespace assert {
    function equal(actual: unknown, expected: unknown, message?: string): void;
    function match(value: string, regExp: RegExp, message?: string): void;
  }
  export default assert;
}

declare module 'node:http' {
  export type IncomingHttpHeaders = Record<string, string | string[] | undefined>;

  export interface IncomingMessage {
    statusCode?: number;
    headers: IncomingHttpHeaders;
    on(event: 'data', listener: (chunk: Uint8Array) => void): this;
    on(event: 'end', listener: () => void): this;
  }

  export interface ClientRequest {
    on(event: 'error', listener: (err: Error) => void): this;
    end(): void;
  }

  export interface AddressInfo {
    address: string;
    family: string;
    port: number;
  }

  export interface Server {
    once(event: 'error', listener: (err: Error) => void): this;
    listen(port: number, host: string, callback?: () => void): this;
    address(): AddressInfo | string | null;
    close(callback?: (err?: Error) => void): this;
    closeAllConnections(): void;
  }

  export interface RequestOptions {
    hostname: string;
    port: number;
    path: string;
    method?: string;
    headers?: Record<string, string>;
  }

  const http: {
    request(options: RequestOptions, callback: (res: IncomingMessage) => void): ClientRequest;
  };
  export default http;
}

declare module 'node:fs/promises' {
  const fs: {
    readFile(filePath: string, encoding: 'utf8'): Promise<string>;
    readdir(dirPath: string): Promise<string[]>;
    access(filePath: string): Promise<void>;
  };
  export default fs;
}

declare module 'node:path' {
  const path: {
    join(...paths: string[]): string;
    resolve(...paths: string[]): string;
  };
  export default path;
}

declare module '../server/index.mjs' {
  import type http from 'node:http';
  export const ROOT: string;
  export const DIST: string;
  export function createLocalServer(distDir?: string): http.Server;
}
