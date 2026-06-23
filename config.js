/* The Crash Factory - public client config (SHARED Supabase identity).
   Same Supabase project as Revenue Board / Blast / the rest of Five Stone, on
   purpose: one person = one permanent UID across every app (AutoCloud).
   The anon key is SAFE in the browser (built for client use; row-level security
   protects the data). The service_role key must NEVER go here.

   Mirrors the standard Roles & Access kit (supabaseClient.js) so the owner-only
   board behaves identically here. Only THIS_APP differs per site. */
window.CF_CONFIG = {
  SUPABASE_URL: "https://gcrzmiwgjvuujffbqjbq.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdjcnptaXdnanZ1dWpmZmJxamJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4MjQyODYsImV4cCI6MjA5NzQwMDI4Nn0.6Rol3Pxmh8kC_bvr5XkWa3k5s0gRcK9jfLKYmCHM1Ns",

  // This app's own key in the shared app catalog. Used to gate THIS site.
  THIS_APP: "crash",

  // The master Roles & Access board is OWNER-only (only these accounts ever see it,
  // regardless of admin/manager/staff role).
  OWNER_EMAILS: ["fivestoneinvestments@gmail.com"],

  // Standard app catalog — same list on every site. `sensitive` flags financial/credit apps.
  APPS: [
    { key: "blast", label: "Blast" },
    { key: "compliance", label: "Compliance" },
    { key: "revenue", label: "Revenue" },
    { key: "accounting", label: "Accounting" },
    { key: "wantcleancredit", label: "WantCleanCredit", sensitive: true },
    { key: "crash", label: "Crash Factory" }
  ]
};
