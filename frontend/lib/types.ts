export type Role = "admin" | "manager" | "staff";

export type DocumentStatus = "pending" | "processing" | "indexed" | "failed";

export interface NamedRef {
  id: number;
  name: string;
}

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  clearance_level: number;
  organization: (NamedRef & { slug: string }) | null;
  department: NamedRef | null;
  can_upload: boolean;
}

export interface Session {
  token: string;
  user: User;
}

export interface DocumentItem {
  id: number;
  title: string;
  mime_type: string;
  clearance_level: number;
  clearance_label: string;
  status: DocumentStatus;
  error_message: string | null;
  department: NamedRef | null;
  uploaded_by: NamedRef | null;
  created_at: string;
}

export interface Source {
  document_id: number;
  document_title: string;
  page_number: number;
}

export interface AuditLogItem {
  id: number;
  action: string;
  prompt: string | null;
  ip_address: string | null;
  created_at: string;
  user: { id: number; name: string; email: string } | null;
  documents: { id: number; title: string }[];
}

export interface PageMeta {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
}

export const CLEARANCE_LABELS: Record<number, string> = {
  1: "Public",
  2: "Internal",
  3: "Confidential",
  4: "Restricted",
};
