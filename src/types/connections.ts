export type ConnectionEnvironment = 'Production' | 'Staging' | 'Alpha';
export type ConnectionModalMode = 'manage' | 'edit';

export interface ConnectionProfile {
  id: string;
  name: string;
  platformUrl: string;
  organization: string;
  tenants: string;
  clientId: string;
  environment: ConnectionEnvironment;
}
