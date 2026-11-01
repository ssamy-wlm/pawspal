// Checks that run on the phone for a better experience. The server (Supabase Auth) enforces the same rules.
export const MIN_PASSWORD = 12;

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

/** True when the password has at least 12 characters, an upper case letter, a lower case letter and a digit. */
export const isStrongPassword = (v: string) => v.length >= MIN_PASSWORD && /[A-Z]/.test(v) && /[a-z]/.test(v) && /\d/.test(v);
