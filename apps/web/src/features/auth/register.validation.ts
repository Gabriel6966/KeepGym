export interface RegistrationDraft {
  email: string;
  password: string;
  confirmPassword: string;
}
export function validateRegistration(draft: RegistrationDraft):
  | { input: { email: string; password: string }; errors?: never }
  | {
      input?: never;
      errors: Partial<Record<keyof RegistrationDraft, string>>;
    } {
  const errors: Partial<Record<keyof RegistrationDraft, string>> = {},
    email = draft.email.trim(),
    length = [...draft.password].length;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || [...email].length > 320)
    errors.email = 'Enter a valid email address, up to 320 characters.';
  if (length < 15 || length > 128)
    errors.password = 'Use a password with 15–128 characters.';
  if (draft.confirmPassword !== draft.password)
    errors.confirmPassword = 'Passwords must match.';
  return Object.keys(errors).length
    ? { errors }
    : { input: { email, password: draft.password } };
}
