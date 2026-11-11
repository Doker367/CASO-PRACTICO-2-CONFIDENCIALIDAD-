export interface AuthUser {
  id: string;
  name: string;
  email: string;
  roles: string[];
  permissions: string[];
}

export interface TwoFactorStatus {
  enabled: boolean;
  method: 'email';
  email: string;
  enabledAt: string | null;
}

export interface TwoFactorChallenge {
  mfaRequired: true;
  challengeToken: string;
  email: string;
  expiresInSeconds: number;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  description: string | null;
  price: string;
  stock: number;
  imageUrl: string | null;
  categoryId: string | null;
  category?: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  _count?: { products: number };
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: { permission: Permission }[];
  _count?: { users: number };
}

export interface Permission {
  id: string;
  code: string;
  description: string | null;
  area: string;
  action: string;
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  createdAt: string;
  lockedUntil: string | null;
  roles: { role: { id: string; name: string } }[];
}

export interface AuditRow {
  id: string;
  userId: string | null;
  email: string | null;
  action: string;
  resource: string | null;
  resourceId: string | null;
  detail: string | null;
  ipAddress: string;
  userAgent: string | null;
  createdAt: string;
}

export interface CryptoInfo {
  encryption: {
    algorithm: string;
    keyId: string;
    keySource: 'environment' | 'file';
  };
  signing: {
    algorithm: string;
    hash: string;
    keyId: string;
    modulusLength: number;
    publicKeyPem: string;
  };
}

export interface SecureNote {
  id: string;
  title: string;
  body: string | null;
  createdAt: string;
  updatedAt: string;
  status: 'ok' | 'decryption_error';
  error?: string;
  stored: {
    column: string;
    value: string;
    decoded: {
      v: number;
      alg: string;
      keyId: string;
      iv: string;
      tag: string;
      ciphertext: string;
    } | null;
  };
  encryption: {
    algorithm: string;
    keyId: string;
    aad: string;
  };
  signature: {
    algorithm: string;
    hash: string;
    keyId: string;
    value: string;
    valid: boolean;
  };
}
