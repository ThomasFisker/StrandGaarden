import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';

const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID;
const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID;

if (!userPoolId || !clientId) {
  throw new Error('Missing VITE_COGNITO_USER_POOL_ID or VITE_COGNITO_CLIENT_ID');
}

export const userPool = new CognitoUserPool({ UserPoolId: userPoolId, ClientId: clientId });

export const signIn = (email: string, password: string): Promise<CognitoUserSession> =>
  new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: userPool });
    const auth = new AuthenticationDetails({ Username: email, Password: password });
    user.authenticateUser(auth, { onSuccess: resolve, onFailure: reject });
  });

export const signOut = (): void => {
  userPool.getCurrentUser()?.signOut();
};

/** Change the password for the currently signed-in user. Cognito
 * requires the old password as proof of possession even when there's
 * an active session. Resolves on Cognito's "SUCCESS"; rejects with
 * the API error message otherwise. */
export const changeOwnPassword = (
  oldPassword: string,
  newPassword: string,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const user = userPool.getCurrentUser();
    if (!user) return reject(new Error('Ikke logget ind'));
    user.getSession((err: Error | null) => {
      if (err) return reject(err);
      user.changePassword(oldPassword, newPassword, (e2) => {
        if (e2) return reject(e2);
        resolve();
      });
    });
  });

/** Trigger Cognito's ForgotPassword flow. Sends a 6-digit code to the
 * user's verified email. Resolves silently — Cognito intentionally
 * doesn't tell us whether the email exists, to avoid an account-
 * enumeration leak. */
export const requestForgotPasswordCode = (email: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: userPool });
    user.forgotPassword({
      onSuccess: () => resolve(),
      onFailure: (err) => reject(err),
      // inputVerificationCode also fires on success; either is fine here.
      inputVerificationCode: () => resolve(),
    });
  });

/** Confirm the ForgotPassword code and set a new password. */
export const confirmForgotPassword = (
  email: string,
  code: string,
  newPassword: string,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: userPool });
    user.confirmPassword(code, newPassword, {
      onSuccess: () => resolve(),
      onFailure: (err) => reject(err),
    });
  });

export const getCurrentSession = (): Promise<CognitoUserSession | null> =>
  new Promise((resolve) => {
    const user = userPool.getCurrentUser();
    if (!user) return resolve(null);
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) return resolve(null);
      resolve(session);
    });
  });

export interface Claims {
  sub: string;
  email?: string;
  loginName?: string;
  groups: string[];
}

export const claimsFromSession = (session: CognitoUserSession): Claims => {
  const p = session.getIdToken().decodePayload();
  const rawGroups = p['cognito:groups'];
  const groups = Array.isArray(rawGroups)
    ? rawGroups.map(String)
    : typeof rawGroups === 'string'
      ? [rawGroups]
      : [];
  return {
    sub: String(p.sub),
    email: p.email ? String(p.email) : undefined,
    loginName: p.preferred_username ? String(p.preferred_username) : undefined,
    groups,
  };
};
