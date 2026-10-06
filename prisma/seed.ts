// No reference data to seed in the narrowed scope (no banks table, no KYC
// tiers, no system ledger accounts) — kept as a no-op so `prisma migrate
// reset`'s seed step has something valid to run.
async function main(): Promise<void> {}

main();
