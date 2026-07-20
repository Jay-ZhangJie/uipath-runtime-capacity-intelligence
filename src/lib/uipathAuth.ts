import { getAppBase } from '@uipath/uipath-typescript';
import { UiPath } from '@uipath/uipath-typescript/core';
import { requiredScopeText, requiredScopes } from '../config/appConfig';
import type { ProbeConnectionConfig, PublicConnectionConfig } from '../types/live';

let activeSdk: UiPath | null = null;
let oauthExchange: { key: string; promise: Promise<UiPath> } | null = null;

function envValue(key: string) {
  return String(import.meta.env[key] ?? '').trim();
}

export function getDefaultRedirectUri(redirectOrigin = window.location.origin): string {
  try {
    const appBase = getAppBase();
    if (!appBase || appBase === '/') return redirectOrigin;
    return new URL(appBase, redirectOrigin).toString().replace(/\/$/, '');
  } catch {
    return redirectOrigin;
  }
}

export function normalizeOrganizationSlug(organization: string) {
  return organization.trim().toLowerCase();
}

export function normalizeSdkBaseUrl(baseUrl: string): string {
  const fallback = 'https://cloud.uipath.com';
  const normalizedBaseUrl = baseUrl.trim().replace(/\/$/, '');
  if (!normalizedBaseUrl) return fallback;

  try {
    const parsed = new URL(normalizedBaseUrl);
    if (parsed.hostname === 'api.uipath.com') parsed.hostname = 'cloud.uipath.com';
    if (parsed.hostname === 'staging.api.uipath.com') parsed.hostname = 'staging.uipath.com';
    if (parsed.hostname === 'alpha.api.uipath.com') parsed.hostname = 'alpha.uipath.com';

    if (
      parsed.hostname === 'cloud.uipath.com' ||
      parsed.hostname === 'staging.uipath.com' ||
      parsed.hostname === 'alpha.uipath.com'
    ) {
      return parsed.origin;
    }

    return parsed.toString().replace(/\/$/, '');
  } catch {
    return normalizedBaseUrl;
  }
}

export function publicConnectionConfig(config: ProbeConnectionConfig): PublicConnectionConfig {
  return {
    baseUrl: config.baseUrl,
    orgName: config.orgName,
    tenantName: config.tenantName,
    redirectUri: config.redirectUri,
    scopes: config.scope,
  };
}

export function getLiveConfig(override?: ProbeConnectionConfig) {
  const config = override ?? {
    baseUrl: envValue('VITE_UIPATH_BASE_URL') || 'https://cloud.uipath.com',
    orgName: normalizeOrganizationSlug(envValue('VITE_UIPATH_ORG_NAME')),
    tenantName: envValue('VITE_UIPATH_TENANT_NAME'),
    clientId: envValue('VITE_UIPATH_CLIENT_ID'),
    redirectUri: envValue('VITE_UIPATH_REDIRECT_URI') || getDefaultRedirectUri(),
    scope: envValue('VITE_UIPATH_SCOPE') || requiredScopeText,
  };

  config.baseUrl = normalizeSdkBaseUrl(config.baseUrl);
  config.orgName = normalizeOrganizationSlug(config.orgName);

  const missing = Object.entries(config)
    .filter(([key, value]) => key !== 'redirectUri' && !value)
    .map(([key]) => key);

  return { config, missing };
}

function cleanCurrentUrl() {
  return `${window.location.origin}${window.location.pathname}${window.location.hash}`;
}

function clearOAuthRedirectQueryString() {
  if (!window.location.search) return;
  window.history.replaceState({}, document.title, cleanCurrentUrl());
}

function parseScopes(scope: string): string[] {
  return Array.from(
    new Set(
      scope
        .split(/\s+/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const [, payload] = token.split('.');
  if (!payload) return null;

  try {
    const normalizedPayload = payload.replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, '=');
    return JSON.parse(window.atob(paddedPayload)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseScopeClaim(claim: unknown) {
  if (Array.isArray(claim)) return claim.filter((scope): scope is string => typeof scope === 'string');
  if (typeof claim === 'string') return claim.split(/\s+/).filter(Boolean);
  return [];
}

function getTokenScopes(token: string | undefined) {
  if (!token) return new Set<string>();
  const payload = decodeJwtPayload(token);
  return new Set([...parseScopeClaim(payload?.scope), ...parseScopeClaim(payload?.scp)]);
}

function assertRequiredScopes(token: string | undefined, configuredScope: string) {
  const configuredScopes = new Set(parseScopes(configuredScope));
  const missingConfiguredScopes = requiredScopes.filter((scope) => !configuredScopes.has(scope));
  if (missingConfiguredScopes.length) {
    throw new Error(`Selected connection is missing required scope(s): ${missingConfiguredScopes.join(', ')}.`);
  }

  const tokenScopes = getTokenScopes(token);
  const missingTokenScopes = requiredScopes.filter((scope) => !tokenScopes.has(scope));
  if (missingTokenScopes.length) {
    throw new Error(
      `UiPath token is missing required scope(s): ${missingTokenScopes.join(', ')}. Confirm the External App includes them, then sign in again.`,
    );
  }
}

function completeOAuthOnce(instance: UiPath, key: string): Promise<UiPath> {
  if (oauthExchange?.key === key) return oauthExchange.promise;
  const promise = instance.completeOAuth().then(() => instance);
  oauthExchange = { key, promise };
  return promise;
}

export type AuthResult =
  | { status: 'authenticated'; sdk: UiPath }
  | { status: 'authenticating'; message: string };

export async function authenticateUiPath(config: ProbeConnectionConfig): Promise<AuthResult> {
  activeSdk?.destroy();
  activeSdk = new UiPath(config);

  if (activeSdk.isInOAuthCallback()) {
    try {
      activeSdk = await completeOAuthOnce(activeSdk, `${config.clientId}:${config.orgName}:${config.tenantName}`);
    } finally {
      clearOAuthRedirectQueryString();
    }
    assertRequiredScopes(activeSdk.getToken(), config.scope);
    return { status: 'authenticated', sdk: activeSdk };
  }

  if (!activeSdk.isAuthenticated()) {
    await activeSdk.initialize();
    if (!activeSdk.isAuthenticated()) {
      return {
        status: 'authenticating',
        message: 'UiPath sign-in redirect started. Complete the browser sign-in to continue.',
      };
    }
  }

  assertRequiredScopes(activeSdk.getToken(), config.scope);
  return { status: 'authenticated', sdk: activeSdk };
}

export function logoutLiveOrchestrator() {
  activeSdk?.logout();
  activeSdk?.destroy();
  activeSdk = null;
}
