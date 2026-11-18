/**
 * Runs before React as an inline <script> in app/layout.tsx (a server
 * component, so this file must not be "use client"). Keep it dependency-free
 * and in sync with lib/theme.ts (same storage key and rule).
 */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem("theme");var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light"}catch(e){}`;
