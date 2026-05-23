import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PenLine, AlertCircle } from "lucide-react";
import { supabase, isSupabaseConfigured } from "../lib/supabase";

export default function Register() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSupabaseConfigured) {
      setError("Please configure Supabase API keys to register.");
      return;
    }
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const { error, data } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: name,
          },
          emailRedirectTo: window.location.origin,
        }
      });
      if (error) throw error;

      const registeredUser = data?.user;
      const activeSession = data?.session;

      // Safe-guard public profile row
      if (registeredUser) {
        try {
          await supabase.from('users').upsert({
            id: registeredUser.id,
            email: registeredUser.email,
            full_name: name,
          });
        } catch (profileErr) {
          console.warn("Could not upsert public profile upon registration", profileErr);
        }
      }

      if (activeSession) {
        // If "Confirm email" is OFF, we are logged in instantly. Navigate home immediately.
        navigate("/");
        return;
      }

      // If no session was established automatically (e.g. email confirmation required/enabled),
      // we attempt to log in using the password.
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        if (signInError.message.toLowerCase().includes("confirm")) {
          setSuccess("Successfully registered! Please check your email to verify your account.");
        } else {
          // If sign in fails for some other reason, e.g., email confirmation needed but with non-confirm message
          setSuccess("Successfully registered! Please check your mail or go to login page.");
        }
      } else if (signInData?.session) {
        // Safe-guard public profile row again under the signed-in session
        if (signInData.user) {
          try {
            await supabase.from('users').upsert({
              id: signInData.user.id,
              email: signInData.user.email,
              full_name: name,
            });
          } catch (profileErr) {
            console.warn("Could not upsert public profile upon sign in", profileErr);
          }
        }
        navigate("/");
      } else {
        setSuccess("Successfully registered! Please sign in.");
      }
    } catch (err: any) {
      setError(err.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8">
        <div className="flex justify-center mb-8">
          <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-sm">
            <PenLine className="w-6 h-6" />
          </div>
        </div>
        <h2 className="text-2xl font-bold text-center text-gray-900 dark:text-white mb-6">Create an account</h2>
        
        {!isSupabaseConfigured && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-lg mb-6 flex gap-3 text-sm">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <div>
              <p className="font-semibold mb-1">Supabase not configured</p>
              <p>Please add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to your environment variables to enable authentication.</p>
            </div>
          </div>
        )}



        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm text-center">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-emerald-50 text-emerald-700 p-4 border border-emerald-200 rounded-lg mb-4 text-sm text-center font-medium">
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded-lg transition-colors border-none disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Signing Up..." : "Sign Up"}
          </button>
        </form>
        
        <p className="mt-6 text-center text-sm text-gray-600 dark:text-gray-400">
          Already have an account? <Link to="/login" className="text-indigo-600 dark:text-indigo-400 font-medium hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
