-- Supabase Schema Setup for Real-Time Collaborative Editor

-- 1. Create tables
CREATE TABLE users (
  id UUID REFERENCES auth.users NOT NULL PRIMARY KEY,
  full_name TEXT,
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT DEFAULT 'Untitled Document',
  content TEXT DEFAULT '',
  owner_id UUID REFERENCES users(id) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TYPE collaborator_role AS ENUM ('owner', 'editor', 'viewer');

CREATE TABLE document_collaborators (
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role collaborator_role NOT NULL,
  PRIMARY KEY (document_id, user_id)
);

CREATE TABLE document_versions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  saved_by UUID REFERENCES users(id),
  version_number INTEGER NOT NULL,
  saved_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Setup Triggers for Auth

-- Insert a row into public.users when a new user signs up via Supabase Auth
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 3. Row Level Security

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;

-- Note: In a production app, you would add rigorous RLS policies here to restrict read/write access.
-- For a quick start/development, we'll allow authenticated users full access.
CREATE POLICY "Allow authenticated access to users" ON users FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow authenticated access to documents" ON documents FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow authenticated access to collaborators" ON document_collaborators FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow authenticated access to versions" ON document_versions FOR ALL TO authenticated USING (true);
