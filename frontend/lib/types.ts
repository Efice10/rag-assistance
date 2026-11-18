export type Role = "admin" | "manager" | "staff";

export type DocumentStatus = "pending" | "processing" | "indexed" | "failed" | "flagged";

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
  version: number;
  superseded: boolean;
  pii_redactions: number;
  approved: boolean;
  department: NamedRef | null;
  uploaded_by: NamedRef | null;
  created_at: string;
}

/** Upload formats; the backend's StoreDocumentRequest accepts the same list. */
export const ACCEPTED_EXTENSIONS = ["pdf", "docx", "xlsx", "pptx", "txt", "md"] as const;

export interface Source {
  document_id: number;
  document_title: string;
  page_number: number;
}

export interface ConversationSummary {
  id: number;
  title: string;
  last_message_at: string | null;
}

export interface Feedback {
  helpful: boolean;
  comment: string | null;
}

export interface StoredMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  sources: Source[];
  error: string | null;
  withheld: boolean;
  created_at: string | null;
  feedback: Feedback | null;
}

export interface SavedTurn {
  conversation_id: number;
  title: string;
  message_id: number;
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

export interface ManagedUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  clearance_level: number;
  department: NamedRef | null;
  active: boolean;
  deactivated_at: string | null;
  created_at: string | null;
}

/** A department as the admin sees it, with counts. */
export interface DepartmentRow extends NamedRef {
  users_count?: number;
  documents_count?: number;
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  staff: "Staff",
};

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
