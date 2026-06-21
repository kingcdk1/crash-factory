/* The Crash Factory - public client config (SHARED Supabase identity).
   Same Supabase project as Revenue Board on purpose: one person = one
   permanent UID across every app, which is the AutoCloud direction.
   The anon key is SAFE in the browser (it is built for client use; row-level
   security protects the data). The service_role key must NEVER go here. */
window.CF_CONFIG = {
  SUPABASE_URL: "https://gcrzmiwgjvuujffbqjbq.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdjcnptaXdnanZ1dWpmZmJxamJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4MjQyODYsImV4cCI6MjA5NzQwMDI4Nn0.6Rol3Pxmh8kC_bvr5XkWa3k5s0gRcK9jfLKYmCHM1Ns"
};
