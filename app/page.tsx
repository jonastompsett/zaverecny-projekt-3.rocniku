'use client';
import { useEffect, useState, useRef } from 'react';
import { auth, db } from '@/lib/firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { 
  collection, addDoc, query, where, onSnapshot, serverTimestamp, orderBy, updateDoc, doc, deleteDoc 
} from 'firebase/firestore';
import { useUploadThing } from "@/lib/uploadthing";

export default function MainPage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<any[]>([]);
  const [activeProject, setActiveProject] = useState<any | null>(null);
  const [view, setView] = useState<'home' | 'library' | 'project'>('home');
  const [isProjectsOpen, setIsProjectsOpen] = useState(true);
  const [libraryFiles, setLibraryFiles] = useState<any[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  
  const [showConfirm, setShowConfirm] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const { startUpload, isUploading } = useUploadThing("mediaUploader", {
    onClientUploadComplete: (res) => {
      console.log("Uploadthing kompletní:", res);
    },
    onUploadError: (error) => {
      console.error("Uploadthing Error:", error);
      alert("Chyba Uploadthing: " + error.message);
    }
  });

  const outlineStyle = {
    textShadow: '1px 1px 0px #888, -1px -1px 0px #888, 1px -1px 0px #888, -1px 1px 0px #888'
  };

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        
        const qProjs = query(
          collection(db, "projects"), 
          where("ownerId", "==", currentUser.uid), 
          orderBy("createdAt", "asc")
        );
        const unsubscribeProjects = onSnapshot(qProjs, (snapshot) => {
          setProjects(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
          setLoading(false);
        }, (err) => {
          console.error("Chyba projektů (zkontroluj indexy):", err);
          setLoading(false);
        });

        const qFiles = query(
          collection(db, "library"), 
          where("ownerId", "==", currentUser.uid), 
          orderBy("createdAt", "desc") 
        );

        const unsubscribeLibrary = onSnapshot(qFiles, (snapshot) => {
          const files = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          console.log("Načteno souborů z DB:", files.length); 
          setLibraryFiles(files);
        }, (err) => {
          console.error("Chyba Library (pravděpodobně chybí INDEX):", err);
          const simpleQuery = query(collection(db, "library"), where("ownerId", "==", currentUser.uid));
          onSnapshot(simpleQuery, (snap) => {
             setLibraryFiles(snap.docs.map(d => ({ id: d.id, ...d.data() })));
          });
        });

        return () => { unsubscribeProjects(); unsubscribeLibrary(); };
      } else {
        router.push('/login');
        setLoading(false);
      }
    });
    return () => unsubscribeAuth();
  }, [router]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || !user) return;
    const fileArray = Array.from(files);
    
    try {
      const res = await startUpload(fileArray);
      
      if (res && res.length > 0) {
        for (const uploadedFile of res) {
          const fileName = uploadedFile.name.toLowerCase();
          const isAudio = fileName.endsWith('.mp3') || 
                          fileName.endsWith('.wav') || 
                          fileName.endsWith('.m4a') ||
                          uploadedFile.type?.includes('audio');

          try {
            await addDoc(collection(db, "library"), {
              name: uploadedFile.name,
              type: isAudio ? 'audio' : 'text',
              ownerId: user.uid,
              createdAt: serverTimestamp(),
              url: uploadedFile.url,
              key: uploadedFile.key,
              size: uploadedFile.size
            });
            console.log("Soubor uložen do Firestore:", uploadedFile.name);
          } catch (dbErr: any) {
            console.error("Chyba při zápisu do DB:", dbErr);
            alert("Soubor se nahrál, ale neuložil do databáze: " + dbErr.message);
          }
        }
        alert("Success! Files added to Library.");
      }
    } catch (err: any) {
      console.error("Celková chyba nahrávání:", err);
    }
  };

  const confirmCreateProject = async () => {
    if (!user) return;
    try {
      const docRef = await addDoc(collection(db, "projects"), {
        title: "New Project",
        ownerId: user.uid,
        createdAt: serverTimestamp(),
      });
      setEditTitle("New Project");
      setEditingProjectId(docRef.id);
      setShowConfirm(false);
    } catch (error) { console.error(error); }
  };

  const handleDeleteProject = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm("Smazat projekt?")) {
      await deleteDoc(doc(db, "projects", id));
      if (activeProject?.id === id) { setView('home'); setActiveProject(null); }
    }
  };

  const handleDeleteFile = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm("Odstranit soubor z knihovny?")) {
      await deleteDoc(doc(db, "library", id));
    }
  };

  const saveTitle = async (id: string) => {
    if (!editTitle.trim()) return;
    await updateDoc(doc(db, "projects", id), { title: editTitle });
    setEditingProjectId(null);
  };

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentChapter, setCurrentChapter] = useState(1);
  const [hasAudio, setHasAudio] = useState(false);

  if (loading) return <div className="h-screen bg-[#3628a1] flex items-center justify-center text-white font-black text-6xl italic" style={outlineStyle}>ReadPal</div>;

  return (
    <div className="flex flex-col h-screen text-white bg-[#3628a1] font-sans overflow-hidden">
      <input type="file" ref={fileInputRef} className="hidden" multiple onChange={(e) => handleFiles(e.target.files)} accept=".txt,.pdf,audio/*" />

      <header className="h-24 border-b border-white/10 flex items-center justify-between px-10 bg-white/5 backdrop-blur-2xl z-50 shrink-0">
        <span onClick={() => { setView('home'); setActiveProject(null); }} className="text-5xl font-black tracking-tighter italic select-none cursor-pointer hover:scale-105 transition-transform" style={outlineStyle}>ReadPal</span>
        <div className="flex items-center gap-10">
          <span className="text-lg font-bold opacity-90" style={outlineStyle}>{user?.displayName || "User"}</span>
          <button onClick={() => signOut(auth)} className="text-sm font-black bg-white/10 hover:bg-white/20 px-8 py-3 rounded-2xl border border-white/10 transition-all uppercase tracking-widest" style={outlineStyle}>Logout</button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-80 glass-card border-r border-white/10 p-8 flex flex-col z-40 shadow-2xl shrink-0">
          <div onClick={() => { setView('library'); setActiveProject(null); }} className={`mb-8 cursor-pointer transition-all hover:translate-x-1 ${view === 'library' ? 'opacity-100' : 'opacity-50'}`}>
            <h3 className="text-2xl font-black uppercase tracking-tighter" style={outlineStyle}>Library</h3>
          </div>

          <div className="flex-1 flex flex-col min-h-0">
            <div onClick={() => setIsProjectsOpen(!isProjectsOpen)} className="flex items-center gap-2 cursor-pointer mb-4 hover:translate-x-1 transition-transform">
              <h3 className="text-2xl font-black uppercase tracking-tighter" style={outlineStyle}>My Projects</h3>
              <span className={`text-xs transition-transform ${isProjectsOpen ? 'rotate-180' : ''}`}>▼</span>
            </div>

            {isProjectsOpen && (
              <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                {projects.map((proj) => (
                  <div key={proj.id} 
                    onClick={() => { if(editingProjectId !== proj.id) { setActiveProject(proj); setView('project'); } }}
                    className={`group p-4 rounded-2xl cursor-pointer transition-all border flex items-center justify-between ${activeProject?.id === proj.id ? 'bg-white/15 border-white/30 shadow-lg' : 'hover:bg-white/5 border-transparent'}`}
                  >
                    {editingProjectId === proj.id ? (
                      <input autoFocus onFocus={(e) => e.target.select()} className="bg-transparent border-b border-white/40 outline-none w-full font-bold text-sm text-white" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} onBlur={() => saveTitle(proj.id)} onKeyDown={(e) => e.key === 'Enter' && saveTitle(proj.id)} onClick={(e) => e.stopPropagation()} />
                    ) : (
                      <>
                        <span className="truncate text-sm font-bold block" style={outlineStyle}>{proj.title}</span>
                        <button onClick={(e) => handleDeleteProject(e, proj.id)} className="opacity-0 group-hover:opacity-40 hover:!opacity-100 transition-opacity p-1 text-white">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </>
                    )}
                  </div>
                ))}
                <div className="mt-2 pt-2 border-t border-white/5">
                  {!showConfirm ? (
                    <div onClick={() => setShowConfirm(true)} className="p-4 rounded-2xl cursor-pointer border border-transparent hover:bg-white/5 transition-all flex items-center">
                      <span className="text-sm font-bold block opacity-40" style={outlineStyle}>+ New Project</span>
                    </div>
                  ) : (
                    <div className="p-4 rounded-2xl border border-white/20 bg-white/10 animate-in zoom-in duration-200 text-center">
                      <p className="text-[10px] font-black uppercase tracking-widest mb-3 opacity-60">Create project?</p>
                      <div className="flex gap-2">
                        <button onClick={() => setShowConfirm(false)} className="flex-1 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-[10px] font-bold uppercase tracking-widest transition-all">No</button>
                        <button onClick={confirmCreateProject} className="flex-1 py-2 rounded-lg bg-white text-[#3628a1] text-[10px] font-bold uppercase tracking-widest transition-all">Yes</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </aside>

        <main className="flex-1 relative overflow-hidden bg-black/5 flex flex-col">
          {view === 'home' && (
            <div className="flex-1 p-12 flex flex-col items-center justify-center animate-in fade-in duration-500">
               <div onClick={() => fileInputRef.current?.click()} onDragOver={(e) => {e.preventDefault(); setIsDragging(true)}} onDragLeave={() => setIsDragging(false)} onDrop={(e) => {e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files)}}
                className={`w-full max-w-4xl h-3/4 border-4 border-solid rounded-[4rem] flex flex-col items-center justify-center transition-all cursor-pointer group ${isDragging ? 'border-white/40 bg-white/10' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}>
                  {isUploading ? (
                    <div className="flex flex-col items-center animate-pulse"><div className="w-16 h-16 border-4 border-white border-t-transparent rounded-full animate-spin mb-4"></div><p className="font-black uppercase tracking-widest" style={outlineStyle}>Uploading...</p></div>
                  ) : (
                    <>
                      <h2 className="text-3xl font-black uppercase tracking-[0.2em] mb-4" style={outlineStyle}>Welcome to ReadPal</h2>
                      <p className="text-white/40 font-bold uppercase tracking-widest" style={outlineStyle}>Drop file here or click to add to Library</p>
                    </>
                  )}
               </div>
            </div>
          )}

          {view === 'library' && (
            <div className="flex-1 p-12 flex flex-col gap-6 animate-in slide-in-from-right-4 duration-500 overflow-hidden">
              <div className="flex justify-start">
                <button onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="text-sm font-black bg-white/10 hover:bg-white/20 px-8 py-3 rounded-2xl border border-white/10 transition-all uppercase tracking-widest disabled:opacity-50" style={outlineStyle}>
                  {isUploading ? "Uploading..." : "+ Upload File"}
                </button>
              </div>

              <div className="flex-1 glass-card border border-white/10 rounded-[3rem] shadow-2xl overflow-hidden flex">
                <div className="flex-1 p-8 border-r border-white/10 flex flex-col">
                  <h3 className="text-sm font-black uppercase tracking-[0.3em] mb-6 opacity-30 text-center" style={outlineStyle}>Text Files</h3>
                  <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar grid grid-cols-1 gap-3 content-start">
                    {libraryFiles.filter(f => f.type === 'text').map((file) => (
                      <div key={file.id} className="group h-20 bg-white/5 border border-white/10 rounded-2xl p-4 hover:bg-white/10 transition-all flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center text-xs">📄</div>
                          <span className="truncate text-xs font-bold" style={outlineStyle}>{file.name}</span>
                        </div>
                        <button onClick={(e) => handleDeleteFile(e, file.id)} className="opacity-0 group-hover:opacity-40 hover:!opacity-100 transition-opacity p-2 text-white">
                           <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                
                <div className="flex-1 p-8 flex flex-col font-bold">
                  <h3 className="text-sm font-black uppercase tracking-[0.3em] mb-6 opacity-30 text-center" style={outlineStyle}>Audio Files</h3>
                  <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar grid grid-cols-1 gap-3 content-start font-bold">
                    {libraryFiles.filter(f => f.type === 'audio').map((file) => (
                      <div key={file.id} className="group h-20 bg-white/5 border border-white/10 rounded-2xl p-4 hover:bg-white/10 transition-all flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center text-xs">🎵</div>
                          <span className="truncate text-xs font-bold" style={outlineStyle}>{file.name}</span>
                        </div>
                        <button onClick={(e) => handleDeleteFile(e, file.id)} className="opacity-0 group-hover:opacity-40 hover:!opacity-100 transition-opacity p-2 text-white">
                           <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {view === 'project' && activeProject && (
            <div className="flex-1 flex flex-col overflow-hidden animate-in fade-in duration-500">
               <div className={`flex-1 p-16 ${isPlaying ? 'overflow-hidden' : 'overflow-y-auto'} custom-scrollbar relative`}>
                <div className="max-w-5xl mx-auto">
                   <div className="h-96 flex items-center justify-center border-2 border-dashed border-white/10 rounded-[3rem]">
                      <button className="bg-white text-black px-10 py-5 rounded-3xl font-black text-sm uppercase tracking-[0.2em] hover:scale-105 transition-transform shadow-2xl">
                        Import Text from Library
                      </button>
                    </div>
                </div>
              </div>
              <div className="h-32 bg-white/5 backdrop-blur-3xl border-t border-white/10 px-12 flex items-center gap-12 shrink-0">
                <div className="shrink-0 min-w-[220px]">
                  {!hasAudio ? (
                    <button onClick={() => setHasAudio(true)} className="w-full bg-white/10 hover:bg-white/20 border border-white/10 px-10 py-5 rounded-3xl transition-all shadow-lg active:scale-95">
                      <span className="font-black text-xs uppercase tracking-[0.2em]" style={outlineStyle}>Upload MP3</span>
                    </button>
                  ) : (
                    <button onClick={() => setIsPlaying(!isPlaying)} className="w-full bg-white text-[#3628a1] px-16 py-5 rounded-3xl font-black text-sm uppercase tracking-[0.3em] hover:scale-105 transition-all shadow-2xl">
                      {isPlaying ? 'Pause' : 'Play'}
                    </button>
                  )}
                </div>
                <button disabled={currentChapter === 1} onClick={() => setCurrentChapter(prev => Math.max(1, prev - 1))} className={`w-14 h-14 rounded-full border border-white/20 flex items-center justify-center transition-all font-black text-xl ${currentChapter === 1 ? 'opacity-20 cursor-not-allowed' : 'hover:bg-white/10'}`}>←</button>
                <div className="flex-1 flex flex-col items-center gap-3">
                  <div className="w-full h-2 bg-white/10 rounded-full relative overflow-hidden cursor-pointer group">
                    <div className="absolute top-0 left-0 h-full bg-white w-1/4 shadow-[0_0_15px_white]"></div>
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-[0.5em] opacity-40" style={outlineStyle}>Chapter {currentChapter}</span>
                </div>
                <button onClick={() => setCurrentChapter(prev => prev + 1)} className="w-14 h-14 rounded-full border border-white/20 flex items-center justify-center hover:bg-white/10 transition-all font-black text-xl">→</button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}