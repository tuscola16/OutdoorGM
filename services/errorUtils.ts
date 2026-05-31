export function friendlyError(err: unknown): string {
  const code: string = (err as any)?.code ?? '';
  const message: string = (err as any)?.message ?? '';

  if (code.includes('unavailable') || code.includes('network-request-failed') || message.includes('network')) {
    return 'No internet connection. Please check your network and try again.';
  }
  if (code.includes('permission-denied')) {
    return 'You don\'t have permission to do that.';
  }
  if (code.includes('not-found')) {
    return 'Not found. Check the code and try again.';
  }
  if (code.includes('too-many-requests')) {
    return 'Too many attempts. Please wait a moment and try again.';
  }
  if (code.includes('requires-recent-login')) {
    return 'For security, please sign out and sign back in, then try again.';
  }
  if (code.includes('wrong-password') || code.includes('invalid-credential')) {
    return 'Incorrect password. Please try again.';
  }
  if (code.includes('app/no-app') || code.includes('auth/')) {
    return 'Authentication error. Please sign out and sign back in.';
  }
  return message || 'Something went wrong. Please try again.';
}
