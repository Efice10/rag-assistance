"use client";

import { KeyRound, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { CLEARANCE_LABELS, type DepartmentRow } from "@/lib/types";

interface Settings {
  enabled: boolean;
  issuer: string;
  client_id: string;
  has_client_secret: boolean;
  email_domain: string;
  default_department_id: number;
  default_role: "staff" | "manager";
  default_clearance_level: number;
}

const FIELD =
  "mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30";

/** Admin panel for the organization's OpenID Connect provider. */
export function SsoSettings({ departments }: { departments: DepartmentRow[] }) {
  const [loaded, setLoaded] = useState(false);
  const [redirectUri, setRedirectUri] = useState("");
  const [hasSecret, setHasSecret] = useState(false);
  const [form, setForm] = useState({
    enabled: false,
    issuer: "",
    client_id: "",
    client_secret: "",
    email_domain: "",
    default_department_id: 0,
    default_role: "staff",
    default_clearance_level: 1,
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api
      .get<{ data: Settings | null; redirect_uri: string }>("/admin/sso")
      .then(({ data }) => {
        setRedirectUri(data.redirect_uri);
        if (data.data) {
          setHasSecret(data.data.has_client_secret);
          setForm((current) => ({ ...current, ...data.data, client_secret: "" }));
        }
        setLoaded(true);
      })
      .catch((err) => setMessage({ ok: false, text: errorMessage(err, "Could not load single sign-on settings.") }));
  }, []);

  const departmentId = form.default_department_id || departments[0]?.id || 0;
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((current) => ({
      ...current,
      [key]: event.target.type === "checkbox" ? (event.target as HTMLInputElement).checked : event.target.value,
    }));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const { data } = await api.put<{ data: Settings }>("/admin/sso", {
        ...form,
        default_department_id: departmentId,
        default_clearance_level: Number(form.default_clearance_level),
      });
      setHasSecret(data.data.has_client_secret);
      setForm((current) => ({ ...current, client_secret: "" }));
      setMessage({ ok: true, text: "Saved." });
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err, "Could not save the settings.") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="sso-heading" className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 id="sso-heading" className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <KeyRound className="h-4 w-4 text-slate-500" aria-hidden /> Single sign-on (OpenID Connect)
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        People with this email domain can sign in through your identity provider. First-time users get the
        defaults below; raise their clearance here afterwards. Password sign-in keeps working.
      </p>

      {!loaded && !message ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
        </p>
      ) : (
        <form onSubmit={save} className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="sso-settings">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700 sm:col-span-2">
            <input type="checkbox" checked={form.enabled} onChange={set("enabled")} className="h-4 w-4 rounded border-slate-300" />
            Enabled
          </label>
          <label className="text-sm font-medium text-slate-700">
            Issuer URL
            <input required type="url" value={form.issuer} onChange={set("issuer")} placeholder="https://login.example.com" className={FIELD} />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Email domain
            <input required value={form.email_domain} onChange={set("email_domain")} placeholder="example.com" className={FIELD} />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Client ID
            <input required value={form.client_id} onChange={set("client_id")} className={FIELD} />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Client secret
            <input
              type="password"
              autoComplete="off"
              required={!hasSecret}
              value={form.client_secret}
              onChange={set("client_secret")}
              placeholder={hasSecret ? "Stored. Leave blank to keep it." : ""}
              className={FIELD}
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Default department
            <select value={departmentId} onChange={set("default_department_id")} className={FIELD}>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-medium text-slate-700">
              Default role
              <select value={form.default_role} onChange={set("default_role")} className={FIELD}>
                <option value="staff">Staff</option>
                <option value="manager">Manager</option>
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">
              Clearance
              <select value={form.default_clearance_level} onChange={set("default_clearance_level")} className={FIELD}>
                {[1, 2].map((level) => (
                  <option key={level} value={level}>
                    {level} · {CLEARANCE_LABELS[level]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs text-slate-500 sm:col-span-2">
            Register this redirect URI with your provider: <code className="rounded bg-slate-100 px-1">{redirectUri}</code>
          </p>
          <div className="flex items-center gap-3 sm:col-span-2">
            <button
              type="submit"
              disabled={saving || departments.length === 0}
              className="flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Save
            </button>
            {message && (
              <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-emerald-700" : "text-rose-700"}`}>
                {message.text}
              </p>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
