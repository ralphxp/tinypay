import { Injectable } from '@nestjs/common';
import { InvalidVerbContextError } from '../../common/errors/domain-errors.js';
import { isGroupSurface, type Surface } from '../../shared/types/surface.js';
import type { AccountRef, GroupRole } from '../../shared/types/account.js';
import type { AuthRequirement, MoneyVerb, TransferTarget } from '../../shared/types/intent.js';

/** Well-known slug for the platform's NGN PSP settlement account (seeded — see prisma/seed.ts). */
const PSP_SETTLEMENT_NGN = 'psp_settlement_ngn';

export interface ResolveActor {
  userId: string;
  groupId?: string;
  role?: GroupRole;
}

export interface ResolveInput {
  surface: Surface;
  verb: MoneyVerb;
  actor: ResolveActor;
  target?: TransferTarget;
}

export interface ResolveResult {
  source: AccountRef;
  dest: AccountRef;
  requiredRole: GroupRole | null;
  requiredAuth: AuthRequirement;
}

function userWallet(userId: string): AccountRef {
  return { ownerType: 'user', ownerId: userId, kind: 'wallet' };
}

function pspSettlement(): AccountRef {
  return { ownerType: 'system', ownerId: PSP_SETTLEMENT_NGN, kind: 'psp_settlement' };
}

function groupPool(groupId: string): AccountRef {
  return { ownerType: 'group', ownerId: groupId, kind: 'pool' };
}

function requireGroupSurface(surface: Surface, verb: MoneyVerb): void {
  if (!isGroupSurface(surface)) {
    throw new InvalidVerbContextError(`"${verb}" must be invoked from a group surface`);
  }
}

function requirePersonalSurface(surface: Surface, verb: MoneyVerb): void {
  if (isGroupSurface(surface)) {
    throw new InvalidVerbContextError(`"${verb}" must be invoked from a personal (DM) surface`);
  }
}

function requireGroupId(actor: ResolveActor, verb: MoneyVerb): string {
  if (!actor.groupId) {
    throw new InvalidVerbContextError(`"${verb}" requires a group context`);
  }
  return actor.groupId;
}

function requireTarget(target: TransferTarget | undefined, verb: MoneyVerb): TransferTarget {
  if (!target) {
    throw new InvalidVerbContextError(`"${verb}" requires a target`);
  }
  return target;
}

function destForTarget(target: TransferTarget): AccountRef {
  return target.type === 'user' ? userWallet(target.userId) : pspSettlement();
}

/**
 * The keystone: (surface, verb, actor, target) -> {source, dest, requiredRole,
 * requiredAuth}. Pure and deterministic — no DB access. Every later module
 * (conversation flows, ledger postings, guards) resolves through this before
 * doing anything else, per guiding principle #4 (context binds source before
 * authorization).
 */
@Injectable()
export class SourceAccountResolver {
  resolve(input: ResolveInput): ResolveResult {
    const { surface, verb, actor, target } = input;

    switch (verb) {
      case 'balance': {
        const wallet = userWallet(actor.userId);
        return { source: wallet, dest: wallet, requiredRole: null, requiredAuth: 'none' };
      }

      case 'fund': {
        requirePersonalSurface(surface, verb);
        return {
          source: pspSettlement(),
          dest: userWallet(actor.userId),
          requiredRole: null,
          requiredAuth: 'none',
        };
      }

      case 'withdraw': {
        requirePersonalSurface(surface, verb);
        return {
          source: userWallet(actor.userId),
          dest: pspSettlement(),
          requiredRole: null,
          requiredAuth: 'pin',
        };
      }

      case 'transfer': {
        requirePersonalSurface(surface, verb);
        const resolvedTarget = requireTarget(target, verb);
        return {
          source: userWallet(actor.userId),
          dest: destForTarget(resolvedTarget),
          requiredRole: null,
          requiredAuth: 'pin',
        };
      }

      case 'contribute': {
        requireGroupSurface(surface, verb);
        const groupId = requireGroupId(actor, verb);
        // Inbound to the pot: any enrolled member may contribute their own money.
        return {
          source: userWallet(actor.userId),
          dest: groupPool(groupId),
          requiredRole: null,
          requiredAuth: 'pin',
        };
      }

      case 'disburse': {
        requireGroupSurface(surface, verb);
        const groupId = requireGroupId(actor, verb);
        const resolvedTarget = requireTarget(target, verb);
        // Outbound from the pot: admin-gated, M-of-N enforced upstream by pools/policy.service.
        return {
          source: groupPool(groupId),
          dest: destForTarget(resolvedTarget),
          requiredRole: 'admin',
          requiredAuth: 'admin_quorum',
        };
      }
    }
  }
}
