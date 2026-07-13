import { connectionStorageKey } from '../config/appConfig';
import type { ConnectionEnvironment, ConnectionProfile } from '../types/connections';

export function inferEnvironment(url: string): ConnectionEnvironment {
  const normalized = url.toLowerCase();
  if (normalized.includes('staging')) return 'Staging';
  if (normalized.includes('alpha')) return 'Alpha';
  return 'Production';
}

export function platformUrlFromApiBase(baseUrl: string) {
  const normalized = baseUrl.toLowerCase();
  if (normalized.includes('staging')) return 'https://staging.uipath.com';
  if (normalized.includes('alpha')) return 'https://alpha.uipath.com';
  return 'https://cloud.uipath.com';
}

export function tenantNameFromConnection(connection: ConnectionProfile | null) {
  if (!connection) return '';
  return connection.tenants
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)[0] ?? '';
}

export function defaultConnectionProfile(): ConnectionProfile {
  const platformUrl = platformUrlFromApiBase(String(import.meta.env.VITE_UIPATH_BASE_URL ?? 'https://cloud.uipath.com'));
  const organization = String(import.meta.env.VITE_UIPATH_ORG_NAME ?? '').trim();
  const tenantsValue = String(import.meta.env.VITE_UIPATH_TENANT_NAME ?? '').trim();
  return {
    id: 'default-connection',
    name: organization || 'New UiPath connection',
    platformUrl,
    organization,
    tenants: tenantsValue,
    clientId: String(import.meta.env.VITE_UIPATH_CLIENT_ID ?? '').trim(),
    environment: inferEnvironment(platformUrl),
  };
}

export function loadConnectionProfiles() {
  try {
    const saved = window.localStorage.getItem(connectionStorageKey);
    if (!saved) return [defaultConnectionProfile()];
    const parsed = JSON.parse(saved) as ConnectionProfile[];
    return parsed.length ? parsed : [defaultConnectionProfile()];
  } catch {
    return [defaultConnectionProfile()];
  }
}

export function saveConnectionProfiles(profiles: ConnectionProfile[]) {
  window.localStorage.setItem(connectionStorageKey, JSON.stringify(profiles));
}
