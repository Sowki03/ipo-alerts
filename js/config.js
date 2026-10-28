// Supabase project details: Dashboard → Project Settings → API.
// The anon key is meant to be public; the database's security rules protect the data.
const SUPABASE_URL = "https://qkktfoajrexbqjfbdadv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFra3Rmb2FqcmV4YnFqZmJkYWR2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxOTI4MzQsImV4cCI6MjEwODc2ODgzNH0.kj-A13rNo-Kh1An3Zk34N9FC51pDnI_IvZ4Hp6o1ruI";

const sb = window.supabase && !SUPABASE_URL.startsWith("PASTE")
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
