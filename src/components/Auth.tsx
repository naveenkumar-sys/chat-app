import { useState, FormEvent } from 'react';
import { insforge } from '../lib/insforge';

interface AuthProps {
  onSuccess: (user: any) => void;
}

export default function Auth({ onSuccess }: AuthProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      if (isLogin) {
        const { data, error } = await insforge.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        
        if (data?.user) {
          onSuccess(data.user);
        }
      } else {
        const { data, error } = await insforge.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        
        if (data?.requireEmailVerification) {
          setSuccess('Signup successful! Please check your email to verify your account.');
          setEmail('');
          setPassword('');
          setTimeout(() => {
            setIsLogin(true);
            setSuccess(null);
          }, 4000);
        } else if (data?.user) {
          setSuccess('Signup successful! Automatic sign-in active.');
          setTimeout(() => {
            onSuccess(data.user);
          }, 1000);
        }
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred during authentication');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto p-8 rounded-2xl bg-neutral-900 border border-neutral-800 shadow-2xl relative z-20">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold tracking-tight text-white mb-2">
          {isLogin ? 'Welcome Back' : 'Create Account'}
        </h2>
        <p className="text-sm text-neutral-400">
          {isLogin ? 'Enter your details to sign in.' : 'Sign up to start chatting instantly.'}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-neutral-300 mb-1.5" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow"
            placeholder="you@example.com"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-300 mb-1.5" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow"
            placeholder="••••••••"
            required
            minLength={6}
          />
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-xl text-sm break-words">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-green-500/10 border border-green-500/20 text-green-400 px-4 py-3 rounded-xl text-sm break-words">
            {success}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 text-white font-semibold rounded-xl px-4 py-3 transition-colors shadow-lg shadow-indigo-500/20"
        >
          {loading ? 'Processing...' : isLogin ? 'Sign In' : 'Sign Up'}
        </button>
      </form>

      <div className="mt-6 text-center text-sm">
        <span className="text-neutral-400">
          {isLogin ? "Don't have an account? " : "Already have an account? "}
        </span>
        <button
          type="button"
          onClick={() => {
            setIsLogin(!isLogin);
            setError(null);
            setSuccess(null);
          }}
          className="text-indigo-400 font-semibold hover:text-indigo-300 transition-colors"
        >
          {isLogin ? 'Sign Up' : 'Sign In'}
        </button>
      </div>
    </div>
  );
}
