// Small things kept in memory while someone moves through sign-up (never stored on the phone, never logged).
// The raw photo paths wait here until both the selfie and the ID are uploaded; then they are sent together.
export type Role = 'owner' | 'sitter';

let facePath: string | null = null;
let idPath: string | null = null;
let pendingEmail = '';

export const setFacePath = (p: string | null) => { facePath = p; };
export const getFacePath = () => facePath;
export const setIdPath = (p: string | null) => { idPath = p; };
export const getIdPath = () => idPath;
export const clearVerificationDraft = () => { facePath = null; idPath = null; };

/** The address a confirmation email was sent to, so the next screens can show and reuse it. */
export const setPendingEmail = (e: string) => { pendingEmail = e; };
export const getPendingEmail = () => pendingEmail;
