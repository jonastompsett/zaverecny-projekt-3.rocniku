'use client';
import { useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  updateProfile 
} from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  doc, 
  setDoc, 
  serverTimestamp 
} from 'firebase/firestore';
import { useRouter } from 'next/navigation';

export default function AuthPage() {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      let emailToUse = identifier.trim();

      if (!emailToUse.includes('@')) {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('username', '==', emailToUse.toLowerCase()));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
          throw new Error('User with this username was not found.');
        }

        emailToUse = querySnapshot.docs[0].data().email;
      }

      await signInWithEmailAndPassword(auth, emailToUse, password);
      router.push('/');
    } catch (err: any) {
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
        setError('Invalid username/email or password.');
      } else {
        setError(err.message || 'Login failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const cleanUsername = username.trim().toLowerCase();
    const cleanEmail = email.trim().toLowerCase();

    try {
      if (!cleanUsername) throw new Error('Please choose a username.');

      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('username', '==', cleanUsername));
      const existingUsers = await getDocs(q);

      if (!existingUsers.empty) {
        throw new Error('This username is already taken.');
      }

      const userCredential = await createUserWithEmailAndPassword(auth, cleanEmail, password);
      const user = userCredential.user;

      await updateProfile(user, { displayName: username.trim() });

      await setDoc(doc(db, 'users', user.uid), {
        username: cleanUsername,
        email: cleanEmail,
        createdAt: serverTimestamp(),
      });

      router.push('/');
    } catch (err: any) {
      if (err.code === 'auth/email-already-in-use') {
        setError('This email is already in use.');
      } else if (err.code === 'auth/weak-password') {
        setError('Password should be at least 6 characters.');
      } else {
        setError(err.message || 'Registration failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen items-center justify-center text-[#F5F5F0] bg-[#081225] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#0e1c36] via-[#081225] to-[#040812] font-sans px-4 selection:bg-white/15 selection:text-white">
      
      <div className="text-center mb-8 select-none">
        <h1 className="text-4xl font-black tracking-tighter italic mb-1 text-[#F5F5F0]">
          ReadPal
        </h1>
        <p className="text-[#F5F5F0]/40 text-[11px] font-bold uppercase tracking-[0.2em]">
          Synchronized Audio & Text Reader
        </p>
      </div>

      <div className="w-full max-w-md bg-[#060d1b]/70 backdrop-blur-2xl border border-white/[0.06] p-8 sm:p-10 rounded-3xl shadow-2xl">
        <div className="flex bg-white/[0.03] p-1 rounded-2xl border border-white/[0.06] mb-8">
          <button
            type="button"
            onClick={() => { setIsRegister(false); setError(null); }}
            className={`flex-1 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all ${
              !isRegister ? 'bg-[#F5F5F0] text-[#081225] shadow' : 'text-[#F5F5F0]/50 hover:text-[#F5F5F0]'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => { setIsRegister(true); setError(null); }}
            className={`flex-1 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all ${
              isRegister ? 'bg-[#F5F5F0] text-[#081225] shadow' : 'text-[#F5F5F0]/50 hover:text-[#F5F5F0]'
            }`}
          >
            Register
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs font-semibold text-center">
            {error}
          </div>
        )}

        <form onSubmit={isRegister ? handleRegister : handleLogin} className="space-y-4">
          {isRegister ? (
            <>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-[#F5F5F0]/40 mb-2 pl-1">
                  Username
                </label>
                <input
                  type="text"
                  required
                  placeholder="johndoe"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/10 text-[#F5F5F0] placeholder-[#F5F5F0]/20 text-sm font-medium outline-none focus:border-white/30 transition-all"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-[#F5F5F0]/40 mb-2 pl-1">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/10 text-[#F5F5F0] placeholder-[#F5F5F0]/20 text-sm font-medium outline-none focus:border-white/30 transition-all"
                />
              </div>
            </>
          ) : (
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-[#F5F5F0]/40 mb-2 pl-1">
                Username or Email
              </label>
              <input
                type="text"
                required
                placeholder="Username or email"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/10 text-[#F5F5F0] placeholder-[#F5F5F0]/20 text-sm font-medium outline-none focus:border-white/30 transition-all"
              />
            </div>
          )}

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-[#F5F5F0]/40 mb-2 pl-1">
              Password
            </label>
            <input
              type="password"
              required
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/10 text-[#F5F5F0] placeholder-[#F5F5F0]/20 text-sm font-medium outline-none focus:border-white/30 transition-all"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-6 py-3.5 rounded-xl bg-[#F5F5F0] text-[#081225] font-black text-xs uppercase tracking-widest hover:bg-white transition-all disabled:opacity-40 disabled:pointer-events-none"
          >
            {loading ? 'Processing...' : isRegister ? 'Create Account' : 'Sign In'}
          </button>
        </form>
      </div>

      <p className="mt-8 text-[#F5F5F0]/30 text-[10px] font-bold uppercase tracking-widest select-none">
        ReadPal Workspace
      </p>
    </div>
  );
}