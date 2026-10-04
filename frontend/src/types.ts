export interface AuthUser {
  id: string;
  name: string;
  email: string;
  roles: string[];
  permissions: string[];
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
