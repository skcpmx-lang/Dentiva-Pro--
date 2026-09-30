import type { Db } from './db'
import type { AppPaths } from './paths'
import type { Permission } from '@shared/permissions'

export interface Actor {
  userId: number
  username: string
  displayName: string
  permissions: Set<string>
}

export function actorCan(actor: Actor, perm: Permission | string): boolean {
  return actor.permissions.has(perm)
}

export interface AppContext {
  db: Db
  paths: AppPaths
  clock: () => Date
  appVersion: string
}

export function nowIso(ctx: AppContext): string {
  return ctx.clock().toISOString()
}
