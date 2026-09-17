import type { AtpAgent } from '@atproto/api';
import type { Env } from './env.ts';
import { isDryRun, publicationAtUri } from './env.ts';

export type RunContext = {
  env: Env;
  dryRun: boolean;
  now: Date;
  trigger: string;
  /** この run で使う publication の AT-URI（env で上書き可能） */
  publicationAtUri: string;
  /** Bluesky のセッション（1回の run で共有する） */
  bsky?: AtpAgent;
  log(level: 'info' | 'warn' | 'error', message: string, extra?: Record<string, unknown>): void;
};

export function createContext(env: Env, trigger: string): RunContext {
  const dryRun = isDryRun(env);
  return {
    env,
    dryRun,
    now: new Date(),
    trigger,
    publicationAtUri: publicationAtUri(env),
    log(level, message, extra) {
      const line = JSON.stringify({
        level,
        msg: message,
        trigger,
        ...(dryRun ? { dryRun: true } : {}),
        ...extra,
      });
      if (level === 'error') console.error(line);
      else if (level === 'warn') console.warn(line);
      else console.log(line);
    },
  };
}
