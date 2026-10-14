import type { Server } from 'node:http';

export const REPO_ROOT: string;
export const WEB_ROOT: string;
export const DIST: string;
export function createLocalServer(distDir?: string): Server;
