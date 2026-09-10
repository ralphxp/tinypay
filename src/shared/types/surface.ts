/** Where a command was issued from. Group surfaces imply a pool context. */
export type Surface = 'telegram_dm' | 'telegram_group' | 'whatsapp_dm' | 'whatsapp_group' | 'web';

export function isGroupSurface(surface: Surface): boolean {
  return surface === 'telegram_group' || surface === 'whatsapp_group';
}
