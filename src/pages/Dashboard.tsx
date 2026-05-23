import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { Document } from "../types";
import { FileText, Plus, LogOut, Search, Clock, AlertCircle, Trash2, Sun, Moon } from "lucide-react";

export default function Dashboard() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) {
      loadDocuments();
    }
  }, [user]);

  const loadDocuments = async () => {
    try {
      // Fetch owned documents
      const { data: ownedDocs, error: ownedError } = await supabase
        .from('documents')
        .select('*')
        .eq('owner_id', user?.id)
        .order('updated_at', { ascending: false });

      if (ownedError) throw ownedError;

      // In a real app we'd fetch shared docs via the collaborators table
      const { data: sharedDocs, error: sharedError } = await supabase
        .from('document_collaborators')
        .select('documents(*)')
        .eq('user_id', user?.id);
        
      if (sharedError) throw sharedError;
      
      const combinedDocs = [
        ...(ownedDocs || []),
        ...(sharedDocs ? sharedDocs.map((s: any) => s.documents) : [])
      ];

      // Remove duplicates and sort
      const uniqueDocs = Array.from(new Map(combinedDocs.map(item => [item.id, item])).values());
      uniqueDocs.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

      setDocuments(uniqueDocs as Document[]);
    } catch (err) {
      console.error(err);
    }
  };

  const createDocument = async () => {
    try {
      if (!user) return;
      
      setCreating(true);
      setError(null);

      // Attempt self-healing profile row insert/upsert in public.users
      try {
        await supabase.from('users').upsert({
          id: user.id,
          email: user.email,
          full_name: user.name,
        });
      } catch (profileErr) {
        console.warn("Could not auto-create public users row", profileErr);
      }

      const { data, error: insertError } = await supabase
        .from('documents')
        .insert([{ title: "Untitled Document", owner_id: user.id }])
        .select()
        .single();
        
      if (insertError) throw insertError;
      navigate(`/doc/${data?.id}`);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to create a new document. Please ensure your Supabase database schema is loaded and accessible.");
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteDocument = async (docId: string, title?: string) => {
    if (!user) return;
    const confirmDelete = window.confirm(`Are you sure you want to permanently delete "${title || 'Untitled Document'}"? This action cannot be undone.`);
    if (!confirmDelete) return;

    try {
      setError(null);
      const { error: deleteError } = await supabase
        .from('documents')
        .delete()
        .eq('id', docId)
        .eq('owner_id', user.id); // Safeguard: must be owner to delete

      if (deleteError) throw deleteError;

      // Update local state
      setDocuments(prev => prev.filter(doc => doc.id !== docId));
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to delete the document.");
    }
  };

  const filteredDocs = documents.filter(doc => 
    doc.title?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 text-gray-900 dark:text-gray-100 flex flex-col transition-colors duration-200">
      <header className="bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 px-6 py-4 flex items-center justify-between transition-colors duration-200">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white">
            <FileText className="w-5 h-5" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Docs</h1>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="text-sm text-gray-600 dark:text-gray-300 hidden sm:block">{user?.name}</div>
          
          <button 
            onClick={toggleTheme}
            className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full transition-colors duration-200"
            title={theme === "light" ? "Switch to Dark Mode" : "Switch to Light Mode"}
          >
            {theme === "light" ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5 text-amber-400" />}
          </button>

          <button 
            onClick={logout}
            className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full transition-colors duration-200"
            title="Log out"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto p-6 md:p-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
          <div className="relative flex-1 max-w-md w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 w-5 h-5" />
            <input
              type="text"
              placeholder="Search documents..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 transition-colors duration-200"
            />
          </div>
          
          <button
            onClick={createDocument}
            disabled={creating}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed w-full sm:w-auto justify-center"
          >
            <Plus className="w-4 h-4" />
            {creating ? "Creating..." : "New Document"}
          </button>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-400 p-4 rounded-xl mb-6 flex gap-3 text-sm animate-in fade-in duration-200">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <div>
              <p className="font-semibold mb-1">Error</p>
              <p>{error}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDocs.map(doc => {
            const isOwner = doc.owner_id === user?.id;
            
            return (
              <Link 
                key={doc.id} 
                to={`/doc/${doc.id}`}
                className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5 hover:shadow-md dark:hover:border-slate-700 transition-all duration-200 flex flex-col h-40 group"
              >
                <div className="flex items-start justify-between mb-2 gap-2">
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 line-clamp-2 flex-1 transition-colors duration-200">
                    {doc.title}
                  </h3>
                  {isOwner && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleDeleteDocument(doc.id, doc.title);
                      }}
                      className="text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 p-1.5 rounded transition-colors shrink-0"
                      title="Delete document"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                
                <div className="mt-auto flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{new Date(doc.updated_at).toLocaleDateString()}</span>
                  </div>
                  <span className={`px-2 py-1 rounded-md font-medium text-[10px] uppercase tracking-wider ${
                    isOwner 
                      ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300' 
                      : 'bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300'
                  }`}>
                    {isOwner ? "Owner" : "Shared"}
                  </span>
                </div>
              </Link>
            )
          })}
          
          {filteredDocs.length === 0 && (
            <div className="col-span-full py-12 text-center text-gray-500 dark:text-gray-400">
              No documents found. Create one to get started!
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
