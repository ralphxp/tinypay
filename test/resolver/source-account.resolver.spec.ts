import { SourceAccountResolver } from '../../src/modules/resolver/source-account.resolver.js';
import { InvalidVerbContextError } from '../../src/common/errors/domain-errors.js';

describe('SourceAccountResolver', () => {
  const resolver = new SourceAccountResolver();
  const actor = { userId: 'user_1' };
  const groupActor = { userId: 'user_1', groupId: 'group_1', role: 'member' as const };

  describe('balance', () => {
    it('reads the actor wallet from any surface, no auth required', () => {
      const result = resolver.resolve({ surface: 'telegram_dm', verb: 'balance', actor });
      expect(result).toEqual({
        source: { ownerType: 'user', ownerId: 'user_1', kind: 'wallet' },
        dest: { ownerType: 'user', ownerId: 'user_1', kind: 'wallet' },
        requiredRole: null,
        requiredAuth: 'none',
      });
    });
  });

  describe('fund', () => {
    it('routes PSP settlement into the actor wallet, no user auth required', () => {
      const result = resolver.resolve({ surface: 'telegram_dm', verb: 'fund', actor });
      expect(result.source).toEqual({
        ownerType: 'system',
        ownerId: 'psp_settlement_ngn',
        kind: 'psp_settlement',
      });
      expect(result.dest).toEqual({ ownerType: 'user', ownerId: 'user_1', kind: 'wallet' });
      expect(result.requiredAuth).toBe('none');
      expect(result.requiredRole).toBeNull();
    });

    it('rejects fund from a group surface', () => {
      expect(() =>
        resolver.resolve({ surface: 'telegram_group', verb: 'fund', actor: groupActor }),
      ).toThrow(InvalidVerbContextError);
    });
  });

  describe('withdraw', () => {
    it('debits the actor wallet to PSP settlement, requires PIN', () => {
      const result = resolver.resolve({ surface: 'whatsapp_dm', verb: 'withdraw', actor });
      expect(result.source).toEqual({ ownerType: 'user', ownerId: 'user_1', kind: 'wallet' });
      expect(result.dest).toEqual({
        ownerType: 'system',
        ownerId: 'psp_settlement_ngn',
        kind: 'psp_settlement',
      });
      expect(result.requiredAuth).toBe('pin');
      expect(result.requiredRole).toBeNull();
    });

    it('rejects withdraw from a group surface', () => {
      expect(() =>
        resolver.resolve({ surface: 'whatsapp_group', verb: 'withdraw', actor: groupActor }),
      ).toThrow(InvalidVerbContextError);
    });
  });

  describe('transfer', () => {
    it('moves between two user wallets, requires PIN', () => {
      const result = resolver.resolve({
        surface: 'telegram_dm',
        verb: 'transfer',
        actor,
        target: { type: 'user', userId: 'user_2' },
      });
      expect(result.source).toEqual({ ownerType: 'user', ownerId: 'user_1', kind: 'wallet' });
      expect(result.dest).toEqual({ ownerType: 'user', ownerId: 'user_2', kind: 'wallet' });
      expect(result.requiredAuth).toBe('pin');
    });

    it('routes external-bank transfers through PSP settlement', () => {
      const result = resolver.resolve({
        surface: 'telegram_dm',
        verb: 'transfer',
        actor,
        target: { type: 'external_bank', accountNumber: '0123456789', bankCode: '058' },
      });
      expect(result.dest).toEqual({
        ownerType: 'system',
        ownerId: 'psp_settlement_ngn',
        kind: 'psp_settlement',
      });
    });

    it('rejects transfer without a target', () => {
      expect(() => resolver.resolve({ surface: 'telegram_dm', verb: 'transfer', actor })).toThrow(
        InvalidVerbContextError,
      );
    });

    it('rejects transfer from a group surface', () => {
      expect(() =>
        resolver.resolve({
          surface: 'telegram_group',
          verb: 'transfer',
          actor: groupActor,
          target: { type: 'user', userId: 'user_2' },
        }),
      ).toThrow(InvalidVerbContextError);
    });
  });

  describe('contribute', () => {
    it('debits the member wallet into the group pool, any member, requires PIN', () => {
      const result = resolver.resolve({
        surface: 'telegram_group',
        verb: 'contribute',
        actor: groupActor,
      });
      expect(result.source).toEqual({ ownerType: 'user', ownerId: 'user_1', kind: 'wallet' });
      expect(result.dest).toEqual({ ownerType: 'group', ownerId: 'group_1', kind: 'pool' });
      expect(result.requiredRole).toBeNull();
      expect(result.requiredAuth).toBe('pin');
    });

    it('rejects contribute from a DM surface', () => {
      expect(() =>
        resolver.resolve({ surface: 'telegram_dm', verb: 'contribute', actor: groupActor }),
      ).toThrow(InvalidVerbContextError);
    });

    it('rejects contribute without a group id', () => {
      expect(() =>
        resolver.resolve({ surface: 'telegram_group', verb: 'contribute', actor }),
      ).toThrow(InvalidVerbContextError);
    });
  });

  describe('disburse', () => {
    it('debits the group pool, requires admin role and quorum auth', () => {
      const result = resolver.resolve({
        surface: 'telegram_group',
        verb: 'disburse',
        actor: { ...groupActor, role: 'admin' },
        target: { type: 'external_bank', accountNumber: '0123456789', bankCode: '058' },
      });
      expect(result.source).toEqual({ ownerType: 'group', ownerId: 'group_1', kind: 'pool' });
      expect(result.dest).toEqual({
        ownerType: 'system',
        ownerId: 'psp_settlement_ngn',
        kind: 'psp_settlement',
      });
      expect(result.requiredRole).toBe('admin');
      expect(result.requiredAuth).toBe('admin_quorum');
    });

    it('can disburse to a member payee', () => {
      const result = resolver.resolve({
        surface: 'whatsapp_group',
        verb: 'disburse',
        actor: { ...groupActor, role: 'admin' },
        target: { type: 'user', userId: 'user_2' },
      });
      expect(result.dest).toEqual({ ownerType: 'user', ownerId: 'user_2', kind: 'wallet' });
    });

    it('rejects disburse from a DM surface', () => {
      expect(() =>
        resolver.resolve({
          surface: 'telegram_dm',
          verb: 'disburse',
          actor: groupActor,
          target: { type: 'user', userId: 'user_2' },
        }),
      ).toThrow(InvalidVerbContextError);
    });

    it('rejects disburse without a target', () => {
      expect(() =>
        resolver.resolve({ surface: 'telegram_group', verb: 'disburse', actor: groupActor }),
      ).toThrow(InvalidVerbContextError);
    });
  });
});
