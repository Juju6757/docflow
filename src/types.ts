export interface User {
  id: string;
  name: string;
  email: string;
  created_at: string;
}

export type Role = "owner" | "editor" | "viewer";

export interface Collaborator {
  user: User | string;
  role: Role;
}

export interface Document {
  id: string;
  title: string;
  content: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface Version {
  id: string;
  document_id: string;
  content: string;
  saved_by: string; // user id
  saved_at: string;
  version_number: number;
}
