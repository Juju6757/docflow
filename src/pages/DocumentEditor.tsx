import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { supabase } from "../lib/supabase";
import { Document, Version, User } from "../types";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, History, Share2, Save, Bold, Italic, Heading, Link as LinkIcon, Code, Trash2, UserPlus, CheckCircle, AlertCircle, RefreshCw, Download, ChevronDown, FileText, Cloud, Check, Sun, Moon } from "lucide-react";
import { cn } from "../lib/utils";
import { io } from "socket.io-client";

export default function DocumentEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [document, setDocument] = useState<Document | null>(null);
  const [content, setContent] = useState("");
  const [collaborators, setCollaborators] = useState<User[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const [shareRole, setShareRole] = useState("editor");
  const [sharedCollaborators, setSharedCollaborators] = useState<any[]>([]);
  const [availableUsers, setAvailableUsers] = useState<any[]>([]);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareSuccess, setShareSuccess] = useState<string | null>(null);
  const [isLoadingShare, setIsLoadingShare] = useState(false);
  const [mobileView, setMobileView] = useState<"edit" | "preview">("edit");
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastType, setToastType] = useState<"success" | "info" | "error">("success");
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const [collaboratorCursors, setCollaboratorCursors] = useState<Record<string, { user: User; cursor: { start: number; end: number } }>>({});

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const channelRef = useRef<any>(null);
  const socketRef = useRef<any>(null);
  const isRemoteUpdateRef = useRef(false);
  const pendingCursorRestoreRef = useRef<{ start: number; end: number } | null>(null);
  const lastDocumentVersionRef = useRef<number>(1);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const titleSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const exportDropdownRef = useRef<HTMLDivElement>(null);

  const triggerToast = (message: string, type: "success" | "info" | "error" = "success") => {
    setToastMessage(message);
    setToastType(type);
    setShowToast(true);
  };

  useEffect(() => {
    if (showToast) {
      const timer = setTimeout(() => {
        setShowToast(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [showToast]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(event.target as Node)) {
        setShowExportDropdown(false);
      }
    };
    window.document.addEventListener("mousedown", handleClickOutside);
    return () => {
      window.document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const exportDocument = (format: 'markdown' | 'text') => {
    if (!document) return;
    const fileExtension = format === 'markdown' ? 'md' : 'txt';
    const mimeType = format === 'markdown' ? 'text/markdown' : 'text/plain';
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a');
    link.href = url;
    link.download = `${document.title || 'untitled'}.${fileExtension}`;
    window.document.body.appendChild(link);
    link.click();
    window.document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setShowExportDropdown(false);
  };

  useEffect(() => {
    loadDocument();
  }, [id]);

  useEffect(() => {
    if (!id || !user) return;

    // Connect to Socket.IO back-end
    const socket = io();
    socketRef.current = socket;

    socket.emit("join-document", {
      docId: id,
      user: {
        id: user.id,
        name: user.name || user.email.split("@")[0],
        email: user.email
      },
      currentContent: content,
      currentTitle: document?.title || ""
    });

    socket.on("document-init", ({ content: initialContent, title: initialTitle, version }) => {
      lastDocumentVersionRef.current = version;
      if (initialContent) {
        isRemoteUpdateRef.current = true;
        setContent(initialContent);
      }
    });

    socket.on("collaborators-updated", (activeCollabs: any[]) => {
      // Map to User type
      const usersList = activeCollabs.map((collab: any) => ({
        id: collab.user?.id,
        name: collab.user?.name || collab.user?.email?.split('@')[0] || "User",
        email: collab.user?.email || ""
      } as User));
      
      const uniqueUsers = usersList.filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);
      setCollaborators(uniqueUsers);

      // Clean up stale cursors
      const activeSocketIds = activeCollabs.map((collab: any) => collab.socketId);
      setCollaboratorCursors(prev => {
        const next = { ...prev };
        let changed = false;
        for (const sockId in next) {
          if (!activeSocketIds.includes(sockId)) {
            delete next[sockId];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    });

    socket.on("document-updated", ({ content: updatedContent, title: updatedTitle, version }) => {
      if (version) {
        lastDocumentVersionRef.current = version;
      }
      
      if (updatedContent !== undefined) {
        const textarea = textareaRef.current;
        if (textarea) {
          pendingCursorRestoreRef.current = {
            start: textarea.selectionStart,
            end: textarea.selectionEnd
          };
        }
        isRemoteUpdateRef.current = true;
        setContent(updatedContent);
      }

      if (updatedTitle !== undefined) {
        setDocument(prev => prev ? { ...prev, title: updatedTitle } : null);
      }
    });

    socket.on("cursor-updated", ({ socketId, user: collabUser, cursor }) => {
      setCollaboratorCursors(prev => ({
        ...prev,
        [socketId]: { user: collabUser, cursor }
      }));
    });

    return () => {
      socket.disconnect();
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (titleSaveTimeoutRef.current) clearTimeout(titleSaveTimeoutRef.current);
    };
  }, [id, user]);

  const handleCursorMove = () => {
    if (textareaRef.current && socketRef.current) {
      socketRef.current.emit("cursor-move", {
        docId: id,
        cursor: {
          start: textareaRef.current.selectionStart,
          end: textareaRef.current.selectionEnd
        }
      });
    }
  };

  // Restore cursor on remote content updates
  useEffect(() => {
    if (isRemoteUpdateRef.current) {
      isRemoteUpdateRef.current = false;
      if (pendingCursorRestoreRef.current && textareaRef.current) {
        const { start, end } = pendingCursorRestoreRef.current;
        textareaRef.current.setSelectionRange(start, end);
        pendingCursorRestoreRef.current = null;
      }
    }
  }, [content]);

  const loadDocument = async () => {
    try {
      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .eq('id', id)
        .single();
        
      if (error) throw error;
      setDocument(data);
      setContent(data.content);
    } catch (error) {
      console.error(error);
      navigate("/");
    }
  };

  const loadVersions = async () => {
    if (!id) return;
    try {
      const { data, error } = await supabase
        .from('document_versions')
        .select('*, saved_by_user:users(*)')
        .eq('document_id', id)
        .order('version_number', { ascending: false });
        
      if (error) throw error;
      setVersions(data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTitle = e.target.value;
    if (document) {
      setDocument({ ...document, title: newTitle });
    }
    
    // Broadcast via Socket.IO
    if (socketRef.current) {
      socketRef.current.emit("edit-document", {
        docId: id,
        title: newTitle,
        version: lastDocumentVersionRef.current,
        authorId: user?.id
      });
    }
    
    setSaveStatus("unsaved");
    if (titleSaveTimeoutRef.current) clearTimeout(titleSaveTimeoutRef.current);
    titleSaveTimeoutRef.current = setTimeout(async () => {
      setIsSaving(true);
      setSaveStatus("saving");
      try {
        const { error } = await supabase.from('documents').update({ title: newTitle, updated_at: new Date().toISOString() }).eq('id', id);
        if (error) throw error;
        setSaveStatus("saved");
        triggerToast("Title saved automatically", "success");
      } catch (err) {
        console.error("Title auto-save failed:", err);
        setSaveStatus("unsaved");
        triggerToast("Failed to save title", "error");
      } finally {
        setIsSaving(false);
      }
    }, 1500);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setContent(newContent);
    setSaveStatus("unsaved");
    
    // Broadcast via Socket.IO
    if (socketRef.current) {
      socketRef.current.emit("edit-document", {
        docId: id,
        content: newContent,
        version: lastDocumentVersionRef.current,
        authorId: user?.id
      });
    }

    // Debounce save to database
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      setIsSaving(true);
      setSaveStatus("saving");
      try {
        const { error } = await supabase.from('documents').update({ content: newContent, updated_at: new Date().toISOString() }).eq('id', id);
        if (error) throw error;
        setSaveStatus("saved");
        triggerToast("Changes saved automatically", "success");
      } catch (err) {
        console.error("Auto-save failed:", err);
        setSaveStatus("unsaved");
        triggerToast("Auto-save failed", "error");
      } finally {
        setIsSaving(false);
      }
    }, 2000);
  };

  const handleSaveVersion = async () => {
    if (!id || !user) return;
    setIsSaving(true);
    setSaveStatus("saving");
    try {
      // Get highest version number
      const { data: lastVersion } = await supabase
        .from('document_versions')
        .select('version_number')
        .eq('document_id', id)
        .order('version_number', { ascending: false })
        .limit(1)
        .single();
        
      const nextVer = (lastVersion?.version_number || 0) + 1;
      
      await supabase.from('document_versions').insert({
        document_id: id,
        content,
        saved_by: user.id,
        version_number: nextVer
      });
      
      loadVersions();
      setSaveStatus("saved");
      triggerToast(`Version ${nextVer} saved successfully!`, "success");
    } catch (e) {
      console.error(e);
      setSaveStatus("unsaved");
      triggerToast("Failed to save version", "error");
    }
    setIsSaving(false);
  };

  const loadSharedCollaborators = async () => {
    if (!id) return;
    try {
      const { data, error } = await supabase
        .from('document_collaborators')
        .select(`
          role,
          user_id,
          user:users(id, email, full_name)
        `)
        .eq('document_id', id);
      if (error) throw error;
      setSharedCollaborators(data || []);
    } catch (e) {
      console.error("Error loading collaborators:", e);
    }
  };

  const loadAvailableUsers = async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, full_name')
        .neq('id', user?.id);
      if (error) throw error;
      setAvailableUsers(data || []);
    } catch (e) {
      console.error("Error loading system users:", e);
    }
  };

  useEffect(() => {
    if (showShare && id) {
      loadSharedCollaborators();
      loadAvailableUsers();
      setShareError(null);
      setShareSuccess(null);
    }
  }, [showShare, id]);

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setShareError(null);
    setShareSuccess(null);
    setIsLoadingShare(true);
    try {
      const emailToShare = shareEmail.trim().toLowerCase();
      
      // Find user by email
      const { data: targetUser, error: findError } = await supabase
        .from('users')
        .select('id, full_name, email')
        .eq('email', emailToShare)
        .maybeSingle();
      
      if (findError) throw findError;
      
      if (!targetUser) {
        setShareError(`No registered user found with email "${shareEmail}". That user needs to register/login first so a profile exists for them in the system.`);
        setIsLoadingShare(false);
        return;
      }

      if (targetUser.id === user?.id) {
        setShareError("You are already the owner of this document.");
        setIsLoadingShare(false);
        return;
      }
      
      const { error: upsertError } = await supabase
        .from('document_collaborators')
        .upsert({
          document_id: id,
          user_id: targetUser.id,
          role: shareRole
        });
      
      if (upsertError) throw upsertError;
      
      setShareSuccess(`Successfully shared with ${targetUser.full_name || targetUser.email} as ${shareRole}!`);
      setShareEmail("");
      loadSharedCollaborators();
    } catch (err: any) {
      console.error(err);
      setShareError(err.message || "An error occurred while sharing.");
    } finally {
      setIsLoadingShare(false);
    }
  };

  const handleRemoveCollaborator = async (targetUserId: string) => {
    if (!id) return;
    setShareError(null);
    setShareSuccess(null);
    try {
      const { error: deleteError } = await supabase
        .from('document_collaborators')
        .delete()
        .eq('document_id', id)
        .eq('user_id', targetUserId);
        
      if (deleteError) throw deleteError;
      
      setShareSuccess("Collaborator access revoked successfully.");
      loadSharedCollaborators();
    } catch (err: any) {
      console.error(err);
      setShareError(err.message || "An error occurred while removing the collaborator.");
    }
  };

  const handleDeleteDocument = async () => {
    if (!id || !document || !user) return;
    const isOwner = document.owner_id === user.id;
    if (!isOwner) {
      triggerToast("Only the document owner can delete this document.", "error");
      return;
    }

    const confirmDelete = window.confirm(`Are you sure you want to permanently delete "${document.title || 'Untitled Document'}"? This action cannot be undone.`);
    if (!confirmDelete) return;

    setSaveStatus("saving");
    try {
      const { error: deleteError } = await supabase
        .from('documents')
        .delete()
        .eq('id', id);

      if (deleteError) throw deleteError;

      triggerToast("Document deleted successfully", "success");
      navigate("/");
    } catch (err: any) {
      console.error(err);
      setSaveStatus("unsaved");
      triggerToast(err.message || "Failed to delete the document.", "error");
    }
  };

  const handleRollback = async (versionId: string, versionContent: string) => {
    if (!id || !confirm("Are you sure you want to rollback to this version? Current changes may be lost.")) return;
    setSaveStatus("saving");
    try {
      setContent(versionContent);
      await supabase.from('documents').update({ content: versionContent, updated_at: new Date().toISOString() }).eq('id', id);
      
      if (socketRef.current) {
        socketRef.current.emit("edit-document", {
          docId: id,
          content: versionContent,
          version: lastDocumentVersionRef.current,
          authorId: user?.id
        });
      }
      
      setShowVersions(false);
      setSaveStatus("saved");
      triggerToast("Doc version rolled back successfully", "info");
    } catch (err) {
      console.error(err);
      setSaveStatus("unsaved");
      triggerToast("Failed to rollback version", "error");
    }
  };

  const insertFormat = (prefix: string, suffix: string = "") => {
    if (!textareaRef.current) return;
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const selectedText = content.substring(start, end);
    const newText = content.substring(0, start) + prefix + selectedText + suffix + content.substring(end);
    
    setContent(newText);
    if (socketRef.current) {
      socketRef.current.emit("edit-document", {
        docId: id,
        content: newText,
        version: lastDocumentVersionRef.current,
        authorId: user?.id
      });
    }
    
    setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(start + prefix.length, end + prefix.length);
    }, 0);
  };

  const wordCount = content.trim() === "" ? 0 : content.trim().split(/\s+/).length;
  const charCount = content.length;
  const readingTime = Math.ceil(wordCount / 200);

  if (!document) return <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-950 text-gray-500 dark:text-gray-400 font-medium animate-pulse duration-1000">Loading...</div>;

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-slate-950 text-gray-900 dark:text-gray-100 transition-colors duration-200">
      {/* Top Header Section */}
      <header className="h-16 bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 px-6 flex items-center justify-between shrink-0 transition-colors duration-200">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/")} className="w-8 h-8 bg-indigo-600 flex items-center justify-center rounded-lg text-white hover:bg-indigo-700 transition-colors" title="Back to Dashboard">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={document.title}
                onChange={handleTitleChange}
                className="text-[15px] font-semibold text-gray-900 dark:text-white bg-transparent border-none focus:ring-0 p-0 m-0 w-full max-w-xs focus:outline-none placeholder-gray-400 dark:placeholder-gray-500"
                placeholder="Untitled Document"
              />
              <span className="bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide">LATEST</span>
            </div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1.5 mt-0.5">
              <div className={cn(
                "w-1.5 h-1.5 rounded-full",
                saveStatus === "saving" && "bg-amber-500 animate-pulse",
                saveStatus === "unsaved" && "bg-yellow-400 animate-pulse",
                saveStatus === "saved" && "bg-emerald-500"
              )}></div>
              <span>
                {saveStatus === "saving" && "Saving changes..."}
                {saveStatus === "unsaved" && "Unsaved changes"}
                {saveStatus === "saved" && "Saved to Cloud"}
              </span>
              <span>•</span>
              <span>{collaborators.length} active collaborator{collaborators.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          <div className="hidden md:flex -space-x-2 mr-2">
            {collaborators.map((c, i) => (
              <div 
                key={i} 
                className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[10px] font-bold border-2 border-white dark:border-slate-900"
                title={c.name}
              >
                {c.name?.substring(0, 2).toUpperCase() || 'U'}
              </div>
            ))}
          </div>
          
          <button 
            onClick={toggleTheme}
            className="p-1.5 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded transition-colors flex items-center justify-center"
            title={theme === "light" ? "Switch to Dark Mode" : "Switch to Light Mode"}
          >
            {theme === "light" ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5 text-amber-400" />}
          </button>

          <button 
            onClick={() => {
              loadVersions();
              setShowVersions(!showVersions);
            }}
            className="p-1.5 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded transition-colors flex items-center justify-center font-medium"
            title="Version History"
          >
            <History className="w-5 h-5" />
          </button>

          {/* Export Dropdown Menu */}
          <div className="relative" ref={exportDropdownRef}>
            <button 
              onClick={() => setShowExportDropdown(!showExportDropdown)}
              className="px-3 py-1.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-850 rounded-lg flex items-center gap-1.5 text-sm font-medium transition-colors border-solid"
              title="Export Document"
            >
              <Download className="w-4 h-4 text-gray-500 dark:text-gray-450" />
              <span className="hidden sm:inline">Export</span>
              <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            </button>

            {showExportDropdown && (
              <div className="absolute right-0 mt-1 w-44 bg-white dark:bg-slate-900 border border-gray-150 dark:border-slate-800 rounded-xl shadow-lg py-1 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                <button
                  type="button"
                  onClick={() => exportDocument('markdown')}
                  className="w-full text-left px-3.5 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 hover:text-indigo-600 dark:hover:text-indigo-300 transition-colors flex items-center gap-2 border-none font-medium bg-transparent cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                  <span>Markdown (.md)</span>
                </button>
                <button
                  type="button"
                  onClick={() => exportDocument('text')}
                  className="w-full text-left px-3.5 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 hover:text-indigo-600 dark:hover:text-indigo-300 transition-colors flex items-center gap-2 border-none font-medium bg-transparent cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  <span>Plain Text (.txt)</span>
                </button>
              </div>
            )}
          </div>
          
          <button 
            onClick={() => setShowShare(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 sm:px-4 py-2 rounded-md font-medium text-[13px] border-none transition-colors"
          >
            Share
          </button>

          {document?.owner_id === user?.id && (
            <button 
              onClick={handleDeleteDocument}
              className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 border border-gray-200 dark:border-slate-700 hover:border-red-100 rounded-md transition-colors flex items-center justify-center bg-white dark:bg-slate-900"
              title="Delete Document"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          )}

          <button 
            onClick={handleSaveVersion}
            disabled={isSaving}
            className="hidden sm:flex bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 px-3 py-1.5 rounded-md items-center gap-1.5 text-sm font-medium transition-colors disabled:opacity-50"
            title="Save Version"
          >
            <Save className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Toolbar Segment */}
      <div className="h-12 border-b border-gray-200 dark:border-slate-800 bg-[#FDFDFD] dark:bg-slate-900 px-4 flex items-center gap-2 overflow-x-auto shrink-0 transition-colors duration-200">
        <button onClick={() => insertFormat("### ", "")} className="w-8 h-8 flex items-center justify-center text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded font-bold text-sm cursor-pointer" title="Heading">H</button>
        <div className="w-px h-6 bg-gray-200 dark:bg-slate-800 mx-1"></div>
        <button onClick={() => insertFormat("**", "**")} className="w-8 h-8 flex items-center justify-center text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded font-bold text-sm cursor-pointer" title="Bold">B</button>
        <button onClick={() => insertFormat("*", "*")} className="w-8 h-8 flex items-center justify-center text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded italic text-sm cursor-pointer" title="Italic">I</button>
        <div className="w-px h-6 bg-gray-200 dark:bg-slate-800 mx-1"></div>
        <button onClick={() => insertFormat("[", "](url)")} className="w-8 h-8 flex items-center justify-center text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded cursor-pointer" title="Link"><LinkIcon className="w-4 h-4" /></button>
        <button onClick={() => insertFormat("```\n", "\n```")} className="w-8 h-8 flex items-center justify-center text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded font-mono text-sm cursor-pointer" title="Code Block">&lt;/&gt;</button>
        
        {/* Mobile View Toggle */}
        <div className="ml-auto flex sm:hidden border border-gray-200 dark:border-slate-700 rounded-md overflow-hidden text-xs font-medium">
          <button 
            type="button"
            className={cn("px-3 py-1 transition-colors duration-150 cursor-pointer", mobileView === "edit" ? "bg-gray-100 dark:bg-slate-800 text-gray-900 dark:text-white" : "bg-white dark:bg-slate-900 text-gray-500 dark:text-gray-400")}
            onClick={() => setMobileView("edit")}
          >Edit</button>
          <button 
            type="button"
            className={cn("px-3 py-1 border-l border-gray-200 dark:border-slate-700 transition-colors duration-150 cursor-pointer", mobileView === "preview" ? "bg-gray-100 dark:bg-slate-800 text-gray-900 dark:text-white" : "bg-white dark:bg-slate-900 text-gray-500 dark:text-gray-400")}
            onClick={() => setMobileView("preview")}
          >Preview</button>
        </div>
      </div>

      {/* Editor & Preview Panes */}
      <div className="flex-1 overflow-hidden flex relative bg-white dark:bg-slate-950 transition-colors duration-200">
        <div className={cn(
          "h-full border-r border-gray-200 dark:border-slate-800 flex flex-col bg-white dark:bg-slate-950 overflow-hidden transition-colors duration-200",
          mobileView === "preview" ? "hidden sm:flex" : "flex w-full sm:flex-1"
        )}>
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleChange}
            onSelect={handleCursorMove}
            onKeyUp={handleCursorMove}
            onMouseDown={handleCursorMove}
            placeholder="Start typing in Markdown..."
            className="flex-1 w-full p-5 resize-none outline-none font-mono text-[14px] leading-relaxed text-gray-800 dark:text-slate-100 bg-transparent placeholder-gray-400 dark:placeholder-slate-600 focus:outline-none focus:ring-0"
            spellCheck="false"
          />

          {/* Active collaborator status footer */}
          {Object.values(collaboratorCursors).length > 0 && (
            <div className="px-5 py-2 border-t border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/40 flex flex-wrap items-center gap-3 select-none text-[11px] font-medium text-gray-500 dark:text-gray-400 shrink-0 transition-colors duration-200">
              <span className="flex items-center gap-1.5 font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider text-[10px]">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-indigo-500"></span>
                </span>
                Active Editors:
              </span>
              {Object.values(collaboratorCursors).map((item, index) => {
                const startChar = item.cursor?.start ?? 0;
                const endChar = item.cursor?.end ?? 0;
                const isSelected = endChar > startChar;
                return (
                  <div key={index} className="bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-300 px-2.5 py-0.5 rounded-full border border-indigo-100/40 dark:border-indigo-900/30 flex items-center gap-1">
                    <span className="font-semibold">{item.user?.name || item.user?.email?.split('@')[0]}</span>
                    <span className="text-indigo-400">
                      {isSelected 
                        ? `selected ${startChar}-${endChar}`
                        : `at char ${startChar}`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        
        <div className={cn(
          "h-full overflow-y-auto p-10 bg-gray-50 dark:bg-slate-900/60 transition-colors duration-200",
          mobileView === "edit" ? "hidden sm:block" : "block w-full sm:flex-1",
          showVersions && "hidden lg:block lg:flex-1" // Hide preview on medium screens when versions are open
        )}>
          <div className="prose prose-sm sm:prose-base dark:prose-invert max-w-none prose-h1:mt-0 prose-h2:mt-0 prose-h3:mt-0 prose-code:bg-gray-200 dark:prose-code:bg-slate-800 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-[0.9em] text-gray-850 dark:text-slate-200">
            <Markdown remarkPlugins={[remarkGfm]}>{content || "*Empty document*"}</Markdown>
          </div>
        </div>

        {/* Modals & Overlays */}
        {showShare && (
          <div className="fixed inset-0 bg-black/45 dark:bg-black/60 flex items-center justify-center z-50 p-4 transition-all animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[85vh] transform transition-all animate-in zoom-in-95 duration-200 text-gray-900 dark:text-gray-100 border border-transparent dark:border-slate-800">
              <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex justify-between items-center bg-gray-50/70 dark:bg-slate-900/60">
                <div className="flex items-center gap-2">
                  <Share2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <h3 className="font-semibold text-gray-900 dark:text-white text-sm">Manage Document Access</h3>
                </div>
                <button 
                  onClick={() => setShowShare(false)} 
                  className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 text-lg leading-none h-6 w-6 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors focus:outline-none cursor-pointer"
                >
                  ×
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-5">
                {/* Alert/Status Messages */}
                {shareError && (
                  <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 text-red-700 dark:text-red-450 p-3 rounded-lg text-xs flex gap-2 items-start animate-in fade-in">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">Failed to Share</p>
                      <p className="mt-0.5">{shareError}</p>
                    </div>
                  </div>
                )}

                {shareSuccess && (
                  <div className="bg-emerald-50 dark:bg-emerald-950/15 border border-emerald-200 dark:border-emerald-900/20 text-emerald-700 dark:text-emerald-400 p-3 rounded-lg text-xs flex gap-2 items-start animate-in fade-in">
                    <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <p className="font-medium">{shareSuccess}</p>
                  </div>
                )}

                {/* Add Collaborator Form */}
                <form onSubmit={handleShare} className="space-y-3.5 bg-gray-50 dark:bg-slate-900/40 p-3.5 rounded-xl border border-gray-100 dark:border-slate-800">
                  <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Invite New Collaborator</h4>
                  
                  <div className="space-y-2.5">
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-455 mb-1">Email address</label>
                      <input 
                        type="email" 
                        required 
                        value={shareEmail} 
                        onChange={e => setShareEmail(e.target.value)} 
                        className="w-full bg-white dark:bg-slate-950 border border-gray-300 dark:border-slate-800 rounded-lg px-3 py-1.5 text-sm text-gray-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-600 focus:outline-none placeholder:text-gray-400 dark:placeholder:text-gray-650 transition-colors"
                        placeholder="collaborator@gmail.com" 
                      />
                    </div>
                    
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-455 mb-1">Permission Role</label>
                      <select 
                        value={shareRole} 
                        onChange={e => setShareRole(e.target.value)} 
                        className="w-full bg-white dark:bg-slate-950 border border-gray-300 dark:border-slate-800 rounded-lg px-3 py-1.5 text-sm text-gray-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-600 focus:outline-none transition-colors"
                      >
                        <option value="editor" className="dark:bg-slate-900">Editor (Can edit document)</option>
                        <option value="viewer" className="dark:bg-slate-900">Viewer (Read-only)</option>
                      </select>
                    </div>
                  </div>

                  <button 
                    type="submit" 
                    disabled={isLoadingShare}
                    className="w-full bg-indigo-600 text-white rounded-lg py-2 text-xs font-semibold hover:bg-indigo-700 transition-colors mt-2.5 flex items-center justify-center gap-1.5 disabled:opacity-50 border-none shrink-0 cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    {isLoadingShare ? "Sharing..." : "Grant Access"}
                  </button>
                </form>

                {/* Suggested System Users for Testing Row */}
                {availableUsers.length > 0 && (
                  <div className="space-y-1.5">
                    <h4 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Suggested Users for Testing</h4>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500">Click any user to populate email field instantly:</p>
                    <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto pr-1">
                      {availableUsers.map((u: any) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => setShareEmail(u.email)}
                          className="text-[11px] bg-indigo-50 dark:bg-indigo-950/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 px-2.5 py-1 rounded-md transition-colors font-medium border-none text-left truncate max-w-full cursor-pointer"
                          title={u.email}
                        >
                          {u.full_name || u.email.split('@')[0]} ({u.email})
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Current Collaborator Inventory */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-gray-500 dark:text-gray-450 uppercase tracking-wider">Users with Access</h4>
                  <div className="divide-y divide-gray-100 dark:divide-slate-800 border border-gray-100 dark:border-slate-800 rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                    {sharedCollaborators.length === 0 ? (
                      <div className="p-3 text-center text-xs text-gray-400 dark:text-gray-500 bg-gray-50/50 dark:bg-slate-900/30">
                        No collaborators added to this document yet.
                      </div>
                    ) : (
                      sharedCollaborators.map((collab: any) => (
                        <div key={collab.user_id} className="p-2.5 px-3 flex items-center justify-between text-xs hover:bg-gray-50/40 dark:hover:bg-slate-850 bg-white dark:bg-slate-900/40 transition-colors">
                          <div className="min-w-0 max-w-[70%]">
                            <p className="font-semibold text-gray-900 dark:text-white truncate">
                              {collab.user?.full_name || "Anonymous User"}
                            </p>
                            <p className="text-gray-400 dark:text-gray-500 text-[10px] truncate">{collab.user?.email}</p>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              "px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider",
                              collab.role === "editor" ? "bg-amber-50 dark:bg-amber-955/35 text-amber-600 dark:text-amber-450" : "bg-blue-50 dark:bg-blue-955/35 text-blue-600 dark:text-blue-455"
                            )}>
                              {collab.role}
                            </span>
                            
                            <button
                              onClick={() => handleRemoveCollaborator(collab.user_id)}
                              className="text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 p-1.5 rounded transition-colors border-none cursor-pointer"
                              title="Revoke Access"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {showVersions && (
          <aside className="absolute inset-y-0 right-0 sm:relative w-full sm:w-[260px] bg-white dark:bg-slate-900 border-l border-gray-200 dark:border-slate-800 shrink-0 flex flex-col z-10 shadow-2xl sm:shadow-none text-gray-900 dark:text-gray-100 transition-colors duration-200">
            <div className="p-4 border-b border-gray-200 dark:border-slate-800 text-xs font-bold uppercase tracking-[0.05em] text-gray-500 dark:text-gray-400 flex justify-between items-center bg-[#FDFDFD] dark:bg-slate-900/60">
              Version History
              <button onClick={() => setShowVersions(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-350 text-lg leading-none cursor-pointer bg-transparent border-none">×</button>
            </div>
            <div className="flex-1 overflow-y-auto bg-white dark:bg-slate-900">
              {versions.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400 p-4 text-center">No explicit versions saved yet.</p>}
              {versions.map((v: any, i) => (
                <div key={v.id} className={cn("p-3 px-4 border-b border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-850 cursor-pointer group transition-colors duration-150", i === 0 ? "bg-indigo-50/50 dark:bg-indigo-950/20 border-l-4 border-l-indigo-600" : "")}>
                  <div className="flex items-center justify-between mb-1 text-gray-900 dark:text-slate-100">
                    <span className="font-semibold text-[12px]">{i === 0 ? `Version ${v.version_number} (Current)` : `Version ${v.version_number}`}</span>
                    <span className="text-[11px] text-gray-400 dark:text-gray-500">{new Date(v.saved_at).toLocaleTimeString([], { hour: '2-digit', minute:'2-digit' })}</span>
                  </div>
                  <div className="text-[12px] text-gray-500 dark:text-gray-400 mb-2 font-medium">by {v.saved_by_user?.full_name || "Unknown"}</div>
                  <button onClick={() => handleRollback(v.id, v.content)} className="text-[11px] bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity w-full font-bold uppercase tracking-wide cursor-pointer border-none">Rollback</button>
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>

      {/* Document Progress & Statistics Footer */}
      <footer className="h-9 border-t border-gray-200 dark:border-slate-800 bg-[#FAF9F6] dark:bg-slate-900/60 px-6 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 shrink-0 transition-colors duration-200 select-none">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 font-medium">
            <span className="font-semibold text-gray-950 dark:text-slate-100">{wordCount}</span> 
            <span>{wordCount === 1 ? 'word' : 'words'}</span>
          </span>
          <span className="w-1 h-1 rounded-full bg-gray-300 dark:bg-slate-705"></span>
          <span className="flex items-center gap-1.5 font-medium">
            <span className="font-semibold text-gray-950 dark:text-slate-100">{charCount}</span> 
            <span>{charCount === 1 ? 'character' : 'characters'}</span>
          </span>
          <span className="w-1 h-1 rounded-full bg-gray-300 dark:bg-slate-705 hidden sm:inline"></span>
          <span className="hidden sm:flex items-center gap-1.5 font-medium">
            <span>Est. reading time:</span>
            <span className="font-semibold text-gray-900 dark:text-slate-205">{readingTime === 0 ? '< 1' : readingTime} {readingTime <= 1 ? 'min' : 'mins'}</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono font-medium opacity-80 uppercase tracking-widest bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded transition-colors">
            Markdown
          </span>
        </div>
      </footer>

      {/* Floating Toast Notification */}
      {showToast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-3.5 py-2.5 bg-slate-900 border border-slate-800 text-white rounded-xl shadow-2xl transition-all duration-300 animate-in fade-in slide-in-from-bottom-3">
          {toastType === "success" && <Check className="w-4 h-4 text-emerald-400 shrink-0" />}
          {toastType === "info" && <Cloud className="w-4 h-4 text-sky-400 shrink-0" />}
          {toastType === "error" && <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />}
          <span className="text-xs font-semibold mr-1">{toastMessage}</span>
          <button 
            onClick={() => setShowToast(false)} 
            className="text-slate-400 hover:text-white leading-none h-4 w-4 flex items-center justify-center rounded-full hover:bg-slate-800 transition-colors focus:outline-none"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
