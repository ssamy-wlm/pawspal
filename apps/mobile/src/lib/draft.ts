// What the person chose on the Welcome screen, kept in memory until the "About you" step (not stored anywhere).
export type Role = 'owner' | 'sitter' | 'both';
let roleHint: Role | null = null;
export const setRoleHint = (r: string | undefined | null) => { roleHint = r === 'owner' || r === 'sitter' || r === 'both' ? r : roleHint; };
export const getRoleHint = (): Role => roleHint ?? 'both';
