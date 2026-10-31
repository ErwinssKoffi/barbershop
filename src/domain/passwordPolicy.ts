export const PASSWORD_POLICY_MESSAGE = 'Le mot de passe doit contenir au moins 8 caractères, une lettre et un chiffre (maximum 256 caractères).'

/** Pour les nouvelles inscriptions/réinitialisations ; les anciens mots de passe restent utilisables. */
export function isStrongPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 8 && value.length <= 256 &&
    /[a-zA-Z]/.test(value) && /\d/.test(value)
}
