'use client';
import { useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [identifier, setIdentifier] = useState(''); 
  const [password, setPassword] = useState('');
  const router = useRouter();

  const handleLogin = async () => {
    let emailToSignIn = identifier;

    try {
      if (!identifier.includes('@')) {
        const usersRef = collection(db, "users");
        const q = query(usersRef, where("username", "==", identifier));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
          alert("Username not found.");
          return;
        }

        emailToSignIn = querySnapshot.docs[0].data().email;
      }

      await signInWithEmailAndPassword(auth, emailToSignIn, password);
      alert('Login successful!');
      router.push('/');
    } catch (error: any) {
      alert('Error: ' + error.message);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#3628a1]">
      <div className="glass-card p-10 rounded-3xl shadow-2xl w-full max-w-md flex flex-col items-center gap-6">
        <h1 className="text-3xl font-bold text-white">ReadPal</h1>
        <p className="text-white/60 -mt-4 text-sm">Log in to your library</p>

        <input 
          type="text" 
          placeholder="Email or Username" 
          className="w-full bg-white/5 border border-white/20 p-3 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-purple-400 transition placeholder:text-white/40"
          onChange={(e) => setIdentifier(e.target.value)} 
        />
        
        <input 
          type="password" 
          placeholder="Password" 
          className="w-full bg-white/5 border border-white/20 p-3 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-purple-400 transition placeholder:text-white/40"
          onChange={(e) => setPassword(e.target.value)} 
        />
        
        <button 
          onClick={handleLogin} 
          className="w-full bg-white text-[#3628a1] font-bold p-3 rounded-xl hover:bg-purple-100 transition-all active:scale-95"
        >
          Log in
        </button>

        <p className="text-sm text-white/50">
          Don't have an account?{' '}
          <a href="/register" className="text-white hover:underline font-semibold">
            Register here
          </a>
        </p>
      </div>
    </div>
  );
}