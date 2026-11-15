// Optional: bake your Supabase connection into the app so you never type it on a device.
// Leave both empty to enter them on the app's first screen instead.
// The anon key is safe to ship ONLY because the database uses row-level security (see supabase/schema.sql).
window.LEADHUB_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
};
