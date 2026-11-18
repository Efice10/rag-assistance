import axios from "axios";
import { getSession, setSession } from "./session";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api").replace(/\/$/, "");

export const api = axios.create({
  baseURL: API_URL,
  headers: { Accept: "application/json" },
});

api.interceptors.request.use((config) => {
  const session = getSession();
  if (session) {
    config.headers.Authorization = `Bearer ${session.token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // An expired or revoked token signs the user out everywhere.
    if (axios.isAxiosError(error) && error.response?.status === 401 && getSession()) {
      setSession(null);
    }
    return Promise.reject(error);
  },
);

/** Turn an API failure into a sentence a person can act on. */
export function errorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    if (!error.response) {
      return "Cannot reach the server. Check that the backend is running on port 8000.";
    }
    const data = error.response.data as { message?: string; errors?: Record<string, string[]> } | undefined;
    const firstFieldError = data?.errors ? Object.values(data.errors)[0]?.[0] : undefined;
    return firstFieldError ?? data?.message ?? fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

function extensionFor(contentType: string): string {
  if (contentType.includes("pdf")) return "pdf";
  if (contentType.includes("spreadsheet")) return "xlsx";
  if (contentType.includes("presentation")) return "pptx";
  if (contentType.includes("wordprocessing")) return "docx";
  if (contentType.includes("markdown")) return "md";
  if (contentType.includes("text/plain")) return "txt";
  return "bin";
}

/** Save a blob response as a file. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Download a document through the API, which re-checks access on every request. */
export async function downloadDocument(id: number, title: string): Promise<void> {
  const response = await api.get(`/documents/${id}/download`, { responseType: "blob" });
  saveBlob(response.data as Blob, `${title}.${extensionFor(String(response.headers["content-type"] ?? ""))}`);
}
