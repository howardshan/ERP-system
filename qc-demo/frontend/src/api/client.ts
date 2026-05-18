const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}`
  : '/api';

export type AuthState = {
  token: string;
  role: string;
  username: string;
  displayName?: string;
};

const AUTH_KEY = 'qc_demo_auth';

export function loadAuth(): AuthState | null {
  const raw = localStorage.getItem(AUTH_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthState;
  } catch {
    return null;
  }
}

export function saveAuth(auth: AuthState) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
}

export function clearAuth() {
  localStorage.removeItem(AUTH_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const auth = loadAuth();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (auth?.token) {
    headers.Authorization = `Bearer ${auth.token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 401) {
    clearAuth();
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Request failed');
  }
  return res.json() as Promise<T>;
}

export const api = {
  login: (username: string, password: string) =>
    request<{
      access_token: string;
      role: string;
      username: string;
      display_name?: string;
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  health: () => request<{ status: string; database: string }>('/health'),

  seed: () => request<{ ok: boolean }>('/demo/seed', { method: 'POST' }),

  skus: () => request<Product[]>(`/products`),
  products: () => request<Product[]>(`/products`),
  getProduct: (id: string) => request<Product>(`/products/${id}`),
  createProduct: (body: ProductInput) =>
    request<Product>(`/products`, { method: 'POST', body: JSON.stringify(body) }),
  updateProduct: (id: string, body: Partial<ProductInput>) =>
    request<Product>(`/products/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteProduct: (id: string) => request<{ ok: boolean }>(`/products/${id}`, { method: 'DELETE' }),
  locations: () =>
    request<Array<{ id: string; code: string; display_name: string }>>('/master/locations'),

  productionLots: () => request<ProductionLot[]>('/production-lots'),
  createProductionLot: (body: {
    lot_barcode: string;
    work_order_barcode: string;
    sku_id: string;
    lot_number?: string;
  }) =>
    request<ProductionLot>('/production-lots', { method: 'POST', body: JSON.stringify(body) }),

  productionLotDetail: (id: string) =>
    request<{
      lot: ProductionLot;
      sub_lots: SubLot[];
      events: Array<{ event_type: string; created_at: string; payload: unknown }>;
    }>(`/production-lots/${id}`),

  pending: () => request<SubLot[]>('/pending-inspections'),
  checkInSubLot: (body: {
    production_lot_id: string;
    location_id?: string;
    in_time?: string;
    sub_lot_code?: string;
  }) =>
    request<SubLot>('/drying-sub-lots/check-in', { method: 'POST', body: JSON.stringify(body) }),

  checkOutSubLot: (subLotId: string, out_time?: string) =>
    request<SubLot>(`/drying-sub-lots/${subLotId}/check-out`, {
      method: 'POST',
      body: JSON.stringify({ out_time: out_time ?? null }),
    }),

  inspectionTemplate: (subLotId: string) =>
    request<{
      sub_lot: SubLot;
      template: { item_name: string; lower_limit: number; upper_limit: number };
    }>(`/inspections/template-for-sub-lot/${subLotId}`),

  submitInspection: (drying_sub_lot_id: string, aw: number) =>
    request<{ result: string; new_status: string }>('/inspections', {
      method: 'POST',
      body: JSON.stringify({ drying_sub_lot_id, aw }),
    }),

  dashboard: () =>
    request<{
      pending_count: number;
      longest_wait_minutes: number | null;
      hold_count: number;
      today_passed: number;
      today_failed: number;
      pass_rate: number | null;
      holds: SubLot[];
    }>('/dashboard/summary'),

  disposition: (body: { drying_sub_lot_id: string; type: string; remark?: string }) =>
    request<{ new_status: string }>('/dispositions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

export type ProductionLot = {
  id: string;
  lot_number: string;
  lot_barcode: string;
  work_order_barcode: string;
  sku_id: string;
  sku_code?: string;
  sku_name?: string;
  created_at: string;
};

export type InspectionTemplate = {
  id?: string;
  sku_id?: string;
  item_name: string;
  unit?: string | null;
  lower_limit: number;
  upper_limit: number;
};

export type Product = {
  id: string;
  code: string;
  name: string;
  standard_drying_minutes: number | null;
  templates: InspectionTemplate[];
};

export type ProductInput = {
  code: string;
  name: string;
  standard_drying_minutes?: number | null;
  template: {
    item_name: string;
    unit?: string | null;
    lower_limit: number;
    upper_limit: number;
  };
};

export type SubLot = {
  id: string;
  production_lot_id: string;
  sub_lot_code: string;
  location_id: string | null;
  location_name?: string;
  in_time: string | null;
  out_time: string | null;
  status: string;
  lot_barcode?: string;
  sku_name?: string;
  wait_minutes?: number;
};
