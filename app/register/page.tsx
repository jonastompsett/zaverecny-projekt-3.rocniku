'use client';
import { useState } from 'react';
import { auth, db } from '@/lib/firebase'; 
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore'; 
import { useRouter } from 'next/navigation';

export default function RegisterPage() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const router = useRouter();

  const handleRegister = async () => {
    if (password !== confirmPassword) {
      alert("Passwords do not match!");
      return;
    }

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      await updateProfile(user, { displayName: username });
      await setDoc(doc(db, "users", user.uid), {
        username: username,
        email: email,
        createdAt: new Date()
      });

      alert('Account created successfully!');
      router.push('/'); 
    } catch (error: any) {
      alert('Error: ' + error.message);
    }
  };

  return (
  <div className="flex flex-col items-center justify-center min-h-screen">
    <div className="glass-card p-10 rounded-3xl shadow-2xl w-full max-w-md flex flex-col items-center gap-6">
      <h1 className="text-3xl font-bold">ReadPal</h1>
      <p className="text-white/60 -mt-4 text-sm">Create your account</p>

      <input 
        type="text" 
        placeholder="Username" 
        className="w-full bg-white/5 border border-white/20 p-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-400 transition placeholder:text-white/40"
        onChange={(e) => setUsername(e.target.value)} 
      />

      <input 
        type="email" 
        placeholder="Email" 
        className="w-full bg-white/5 border border-white/20 p-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-400 transition placeholder:text-white/40"
        onChange={(e) => setEmail(e.target.value)} 
      />
      
      <input 
        type="password" 
        placeholder="Password" 
        className="w-full bg-white/5 border border-white/20 p-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-400 transition placeholder:text-white/40"
        onChange={(e) => setPassword(e.target.value)} 
      />

      <input 
        type="password" 
        placeholder="Confirm Password" 
        className="w-full bg-white/5 border border-white/20 p-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-400 transition placeholder:text-white/40"
        onChange={(e) => setConfirmPassword(e.target.value)} 
      />
      
      <button 
        onClick={handleRegister} 
        className="w-full bg-white text-[#3628a1] font-bold p-3 rounded-xl hover:bg-purple-100 transition-all active:scale-95"
      >
        Sign up
      </button>

      <p className="text-sm text-white/50">
        Already have an account?{' '}
        <a href="/login" className="text-white hover:underline font-semibold">
          Log in here
        </a>
      </p>
    </div>
  </div>
);
}