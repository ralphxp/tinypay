import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_SCOPE_KEY = 'idempotent:scope';

/** Marks a handler as requiring an `Idempotency-Key` header; see IdempotencyInterceptor. */
export const Idempotent = (scope: string) => SetMetadata(IDEMPOTENT_SCOPE_KEY, scope);
