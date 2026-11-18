"use client";

import { useSyncExternalStore } from "react";

/**
 * App-wide toasts and confirmation dialogs, as small external stores (the
 * same pattern as lib/session.ts), so any component can call them without a
 * provider. Rendered once by <FeedbackHost /> in the root layout.
 */

export interface Toast {
  id: number;
  tone: "success" | "error";
  message: string;
}

export interface ConfirmRequest {
  title: string;
  body?: string;
  confirmLabel: string;
  tone?: "danger" | "default";
}

interface PendingConfirm extends ConfirmRequest {
  resolve: (confirmed: boolean) => void;
}

const TOAST_MS = 5000;
const listeners = new Set<() => void>();
let toasts: Toast[] = [];
let pending: PendingConfirm | null = null;
let nextId = 1;

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function dismissToast(id: number) {
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}

function push(tone: Toast["tone"], message: string) {
  const id = nextId++;
  toasts = [...toasts.slice(-3), { id, tone, message }];
  emit();
  window.setTimeout(() => dismissToast(id), TOAST_MS);
}

export const toast = {
  success: (message: string) => push("success", message),
  error: (message: string) => push("error", message),
};

/** Ask the user to confirm. Resolves false if they cancel or press Escape. */
export function confirmAction(request: ConfirmRequest): Promise<boolean> {
  pending?.resolve(false);
  return new Promise((resolve) => {
    pending = {
      ...request,
      resolve: (confirmed) => {
        pending = null;
        emit();
        resolve(confirmed);
      },
    };
    emit();
  });
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, () => toasts, () => toasts);
}

export function usePendingConfirm(): PendingConfirm | null {
  return useSyncExternalStore(subscribe, () => pending, () => null);
}
