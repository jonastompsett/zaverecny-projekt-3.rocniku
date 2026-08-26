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

  // Audio & Sync States
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [currentChapter, setCurrentChapter] = useState(1);
  const [chapters, setChapters] = useState<{ title: string; content: string; audioUrl?: string; segments?: any[] }[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState("");

  // Modal State
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [wizardMode, setWizardMode] = useState<'text-to-audio' | 'audio-to-text'>('text-to-audio');
  const [selectedLanguage, setSelectedLanguage] = useState<'cs' | 'en'>('cs');
  const [selectedFile, setSelectedFile] = useState<any>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Robustní dělení kapitol
  const splitIntoChapters = (rawText: string) => {
    if (!rawText) return [{ title: "Chapter 1", content: "" }];
    
    const text = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    const chapterRegex = /(?:^|\n)\s*(?:#+\s*)?(?:(?:Chapter|Kapitola|Část|Part|Díl|Oddíl)\s+[\dIVXLCDM]+|\d+\.\s*(?:Kapitola|Chapter))[^\n]*/gi;
    const matches = Array.from(text.matchAll(chapterRegex));

    if (matches.length <= 1) {
      return [{ title: matches[0] ? matches[0][0].trim() : "Chapter 1", content: text }];
    }

    const parsed = [];
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const start = match.index!;
      const nextMatch = matches[i + 1];
      const end = nextMatch ? nextMatch.index! : text.length;

      const rawBlock = text.substring(start, end).trim();
      const lines = rawBlock.split('\n');
      const title = lines[0].replace(/^#+\s*/, '').trim();
      const content = lines.slice(1).join('\n').trim() || title;

      parsed.push({
        title: title || `Chapter ${i + 1}`,
        content: content
      });
    }
    return parsed;
  };

  const onTimeUpdate = () => {
    const audio = audioRef.current;
    if (audio && audio.duration) {
      setAudioProgress((audio.currentTime / audio.duration) * 100);
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    audio.currentTime = (x / rect.width) * audio.duration;
  };

  useEffect(() => {
    if (isPlaying) audioRef.current?.play().catch(() => setIsPlaying(false));
    else audioRef.current?.pause();
  }, [isPlaying]);

  // Auth & Listeners
  useEffect(() => {
    let unsubscribeProjects: (() => void) | null = null;
    let unsubscribeLibrary: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      if (unsubscribeProjects) unsubscribeProjects();
      if (unsubscribeLibrary) unsubscribeLibrary();

      if (currentUser) {
        setUser(currentUser);
        const qProjs = query(collection(db, "projects"), where("ownerId", "==", currentUser.uid), orderBy("createdAt", "asc"));
        unsubscribeProjects = onSnapshot(qProjs, (snapshot) => {
          setProjects(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
          setLoading(false);
        });

        const qFiles = query(collection(db, "library"), where("ownerId", "==", currentUser.uid), orderBy("createdAt", "desc"));
        unsubscribeLibrary = onSnapshot(qFiles, (snapshot) => {
          setLibraryFiles(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });
      } else {
        setUser(null);
        setProjects([]);
        setLibraryFiles([]);
        setLoading(false);
        router.push('/login');
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProjects) unsubscribeProjects();
      if (unsubscribeLibrary) unsubscribeLibrary();
    };
  }, [router]);

  useEffect(() => {
    setIsPlaying(false);
    setAudioProgress(0);
    if (activeProject) {
      if (activeProject.chapters && activeProject.chapters.length > 0) {
        setChapters(activeProject.chapters);
      } else if (activeProject.textContent) {
        setChapters(splitIntoChapters(activeProject.textContent));
      } else {
        setChapters([]);
      }
      setCurrentChapter(1);
    } else {
      setChapters([]);
    }
  }, [activeProject]);

  const handleChapterChange = (newChapterIndex: number) => {
    setIsPlaying(false);
    setAudioProgress(0);
    setCurrentChapter(newChapterIndex);
  };

  const handleStartGeneration = async () => {
    if (!selectedFile || !activeProject || !user) return;
    setIsGenerating(true);
    setIsWizardOpen(false);

    try {
      if (wizardMode === 'text-to-audio') {
        setGenerationStatus(`Reading text and preparing chapters...`);
        const textRes = await fetch(selectedFile.url);
        const fullText = await textRes.text();

        const rawChapters = splitIntoChapters(fullText);
        const processedChapters = [];

        for (let i = 0; i < rawChapters.length; i++) {
          setGenerationStatus(`Synthesizing Chapter ${i + 1} of ${rawChapters.length}...`);
          const res = await fetch('/api/generate-audio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              text: rawChapters[i].content, 
              language: selectedLanguage,
              chapterIndex: i + 1 
            }),
          });
          const data = await res.json();
          if (data.error) throw new Error(data.error);

          processedChapters.push({
            title: rawChapters[i].title,
            content: rawChapters[i].content,
            audioUrl: data.audioUrl,
            segments: data.segments,
          });
        }

        const updatePayload = {
          sourceTextUrl: selectedFile.url,
          chapters: processedChapters,
          language: selectedLanguage,
          isConfigured: true,
        };

        await updateDoc(doc(db, "projects", activeProject.id), updatePayload);

        setChapters(processedChapters);
        setActiveProject((prev: any) => ({ ...prev, ...updatePayload }));
        setCurrentChapter(1);

      } else {
        setGenerationStatus(`Transcribing audio in ${selectedLanguage === 'cs' ? 'Czech' : 'English'}...`);
        const res = await fetch('/api/generate-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audioUrl: selectedFile.url, language: selectedLanguage }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        const parsedChapters = splitIntoChapters(data.text).map((ch, idx) => ({
          title: ch.title,
          content: ch.content,
          audioUrl: selectedFile.url,
          segments: idx === 0 ? data.segments : [],
        }));

        const updatePayload = {
          sourceAudioUrl: selectedFile.url,
          textContent: data.text,
          chapters: parsedChapters,
          language: selectedLanguage,
          isConfigured: true,
        };

        await updateDoc(doc(db, "projects", activeProject.id), updatePayload);

        setChapters(parsedChapters);
        setActiveProject((prev: any) => ({ ...prev, ...updatePayload }));
        setCurrentChapter(1);
      }
    } catch (err: any) {
      alert("AI Processing Failed: " + err.message);
    } finally {
      setIsGenerating(false);
      setGenerationStatus("");
      setSelectedFile(null);
    }
  };

  const activeChapterData = chapters[currentChapter - 1];
  const currentAudioSrc = activeChapterData?.audioUrl || activeProject?.sourceAudioUrl;
  const currentSegments = activeChapterData?.segments || [];

  const { startUpload, isUploading } = useUploadThing("mediaUploader");

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || !user) return;
    const res = await startUpload(Array.from(files));
    if (res) {
      for (const f of res) {
        const isAudio = f.name.toLowerCase().match(/\.(mp3|wav|m4a)$/);
        await addDoc(collection(db, "library"), {
          name: f.name,
          type: isAudio ? 'audio' : 'text',
          ownerId: user.uid,
          createdAt: serverTimestamp(),
          url: f.url,
        });
      }
    }
  };

  const createNewProject = async () => {
    if (!user) return;
    const docRef = await addDoc(collection(db, "projects"), {
      title: "New Project",
      ownerId: user.uid,
      createdAt: serverTimestamp(),
    });
    setEditTitle("New Project");
    setEditingProjectId(docRef.id);
    setShowConfirm(false);
  };

  const handleDeleteProject = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm("Smazat projekt?")) {
      await deleteDoc(doc(db, "projects", id));
      if (activeProject?.id === id) {
        setActiveProject(null);
        setView('home');
      }
    }
  };

  const saveTitle = async (id: string) => {
    if (!editTitle.trim()) return;
    await updateDoc(doc(db, "projects", id), { title: editTitle });
    setEditingProjectId(null);
  };

  const handleDeleteFile = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm("Odstranit soubor?")) deleteDoc(doc(db, "library", id));
  };

  if (loading) return (
    <div className="h-screen bg-[#081225] flex flex-col items-center justify-center text-[#F5F5F0] select-none">
      <div className="relative flex items-center justify-center mb-6">
        <div className="w-16 h-16 border-2 border-white/10 border-t-[#F5F5F0] rounded-full animate-spin"></div>
        <span className="absolute text-sm font-black italic tracking-tighter">RP</span>
      </div>
      <div className="font-black text-4xl tracking-tighter italic text-[#F5F5F0]">ReadPal</div>
    </div>
  );

  return (
    <div className="flex flex-col h-screen text-[#F5F5F0] bg-[#081225] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#0e1c36] via-[#081225] to-[#040812] font-sans overflow-hidden selection:bg-white/15 selection:text-white">
      <input type="file" ref={fileInputRef} className="hidden" multiple onChange={(e) => handleFiles(e.target.files)} accept=".txt,.pdf,audio/*" />
      <audio ref={audioRef} key={currentAudioSrc} src={currentAudioSrc} onTimeUpdate={onTimeUpdate} onEnded={() => setIsPlaying(false)} />

      {/* HEADER */}
      <header className="h-20 border-b border-white/[0.06] flex items-center justify-between px-10 bg-white/[0.02] backdrop-blur-2xl z-50 shrink-0">
        <span 
          onClick={() => { setView('home'); setActiveProject(null); }} 
          className="text-3xl font-black tracking-tighter italic select-none cursor-pointer hover:opacity-90 transition-opacity text-[#F5F5F0]" 
        >
          ReadPal
        </span>
        <div className="flex items-center gap-6">
          <div className="flex items-center bg-white/[0.04] border border-white/[0.06] px-4 py-2 rounded-xl">
            <span className="text-xs font-bold tracking-wide text-[#F5F5F0]/90">{user?.displayName || "User"}</span>
          </div>
          <button 
            onClick={() => signOut(auth)} 
            className="text-xs font-bold bg-white/[0.04] hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-300 px-5 py-2.5 rounded-xl border border-white/[0.08] transition-all uppercase tracking-widest text-[#F5F5F0]/80" 
          >
            Logout
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* SIDEBAR */}
        <aside className="w-72 bg-[#060d1b]/70 backdrop-blur-2xl border-r border-white/[0.06] p-6 flex flex-col z-40 shrink-0">
          <div 
            onClick={() => { setView('library'); setActiveProject(null); }} 
            className={`p-3.5 rounded-xl cursor-pointer transition-all duration-200 mb-6 flex items-center border ${
              view === 'library' 
                ? 'bg-white/[0.08] border-white/15 text-[#F5F5F0]' 
                : 'hover:bg-white/[0.03] border-transparent text-[#F5F5F0]/50 hover:text-[#F5F5F0]'
            }`}
          >
            <h3 className="text-sm font-black uppercase tracking-wider">Library</h3>
          </div>

          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div 
              onClick={() => setIsProjectsOpen(!isProjectsOpen)} 
              className="flex items-center justify-between px-2 py-2 cursor-pointer mb-2 text-[#F5F5F0]/40 hover:text-[#F5F5F0] transition-colors select-none"
            >
              <h3 className="text-[11px] font-black uppercase tracking-[0.2em]">My Projects</h3>
              <span className={`text-[9px] transition-transform duration-200 ${isProjectsOpen ? 'rotate-180' : ''}`}>▼</span>
            </div>

            {isProjectsOpen && (
              <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                {projects.map((proj) => (
                  <div 
                    key={proj.id} 
                    onClick={() => { if (editingProjectId !== proj.id) { setActiveProject(proj); setView('project'); } }} 
                    className={`group p-3 rounded-xl cursor-pointer transition-all duration-150 border flex items-center justify-between ${
                      activeProject?.id === proj.id 
                        ? 'bg-white/[0.08] border-white/20 text-[#F5F5F0]' 
                        : 'hover:bg-white/[0.03] border-transparent text-[#F5F5F0]/70 hover:text-[#F5F5F0]'
                    }`}
                  >
                    {editingProjectId === proj.id ? (
                      <input 
                        autoFocus 
                        onFocus={(e) => e.target.select()} 
                        className="bg-white/[0.08] px-2 py-1 rounded-lg border-b border-white outline-none w-full font-bold text-xs text-[#F5F5F0]" 
                        value={editTitle} 
                        onChange={(e) => setEditTitle(e.target.value)} 
                        onBlur={() => saveTitle(proj.id)} 
                        onKeyDown={(e) => e.key === 'Enter' && saveTitle(proj.id)} 
                        onClick={(e) => e.stopPropagation()} 
                      />
                    ) : (
                      <>
                        <span className="truncate text-xs font-bold tracking-tight block">{proj.title}</span>
                        <button 
                          onClick={(e) => handleDeleteProject(e, proj.id)} 
                          className="opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-red-400 transition-all p-1"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                ))}

                <div className="pt-2 border-t border-white/[0.04]">
                  {!showConfirm ? (
                    <div 
                      onClick={() => setShowConfirm(true)} 
                      className="p-3 rounded-xl cursor-pointer border border-dashed border-white/10 hover:border-white/20 hover:bg-white/[0.02] transition-all flex items-center justify-center"
                    >
                      <span className="text-[10px] font-black text-[#F5F5F0]/40 tracking-wider">+ NEW PROJECT</span>
                    </div>
                  ) : (
                    <div className="p-3.5 rounded-xl border border-white/15 bg-white/[0.04] text-center">
                      <p className="text-[9px] font-black uppercase mb-2.5 text-[#F5F5F0]/60 tracking-widest">Create project?</p>
                      <div className="flex gap-2">
                        <button onClick={() => setShowConfirm(false)} className="flex-1 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/10 text-[9px] uppercase font-black text-[#F5F5F0]/70">No</button>
                        <button onClick={createNewProject} className="flex-1 py-1.5 rounded-lg bg-[#F5F5F0] text-[#081225] text-[9px] uppercase font-black hover:bg-white transition-colors">Yes</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* MAIN AREA */}
        <main className="flex-1 relative overflow-hidden flex flex-col">
          {view === 'home' && (
            <div className="flex-1 p-12 flex flex-col items-center justify-center animate-in fade-in duration-300">
              <div 
                onClick={() => fileInputRef.current?.click()} 
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }} 
                onDragLeave={() => setIsDragging(false)} 
                onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files); }} 
                className={`w-full max-w-2xl h-80 border border-dashed rounded-3xl flex flex-col items-center justify-center transition-all duration-200 cursor-pointer ${
                  isDragging 
                    ? 'border-white/40 bg-white/[0.06]' 
                    : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]'
                }`}
              >
                {isUploading ? (
                  <div className="flex flex-col items-center animate-pulse">
                    <div className="w-12 h-12 border-2 border-white/20 border-t-[#F5F5F0] rounded-full animate-spin mb-4"></div>
                    <p className="font-bold uppercase tracking-widest text-xs text-[#F5F5F0]">Uploading to Cloud...</p>
                  </div>
                ) : (
                  <>
                    <div className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-center mb-4 text-[#F5F5F0]/70">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                    </div>
                    <h2 className="text-2xl font-black uppercase tracking-wider mb-2 text-[#F5F5F0]">ReadPal Workspace</h2>
                    <p className="text-[#F5F5F0]/40 font-bold uppercase text-[11px] tracking-widest text-center">Drag & drop files here, or click to upload</p>
                  </>
                )}
              </div>
            </div>
          )}

          {view === 'library' && (
            <div className="flex-1 p-10 flex flex-col gap-6 animate-in slide-in-from-right-4 duration-300 overflow-hidden">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-black tracking-tight uppercase text-[#F5F5F0]">Library Storage</h2>
                <button 
                  onClick={() => fileInputRef.current?.click()} 
                  disabled={isUploading} 
                  className="text-xs font-black bg-[#F5F5F0] text-[#081225] hover:bg-white px-5 py-2.5 rounded-xl transition-all uppercase tracking-wider disabled:opacity-50"
                >
                  {isUploading ? "Uploading..." : "+ Upload File"}
                </button>
              </div>

              <div className="flex-1 bg-white/[0.02] border border-white/[0.06] rounded-3xl overflow-hidden flex divide-x divide-white/[0.06]">
                <div className="flex-1 p-6 flex flex-col">
                  <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/[0.06]">
                    <h3 className="text-[11px] font-black uppercase tracking-widest text-[#F5F5F0]/40">Text Documents</h3>
                    <span className="text-xs bg-white/[0.06] px-2 py-0.5 rounded font-mono text-[#F5F5F0]/70">{libraryFiles.filter(f => f.type === 'text').length}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar grid grid-cols-1 gap-2.5 content-start">
                    {libraryFiles.filter(f => f.type === 'text').map((file) => (
                      <div key={file.id} className="group bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.04] hover:border-white/10 rounded-xl p-3.5 transition-all flex items-center justify-between">
                        <div className="flex items-center gap-3 truncate">
                          <div className="w-8 h-8 bg-white/[0.06] rounded-lg flex items-center justify-center shrink-0">
                            <span className="text-[9px] font-black uppercase tracking-wider text-[#F5F5F0]/60">TXT</span>
                          </div>
                          <span className="truncate text-xs font-bold text-[#F5F5F0]/90">{file.name}</span>
                        </div>
                        <button 
                          onClick={(e) => handleDeleteFile(e, file.id)} 
                          className="opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-red-400 transition-all p-1.5"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex-1 p-6 flex flex-col">
                  <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/[0.06]">
                    <h3 className="text-[11px] font-black uppercase tracking-widest text-[#F5F5F0]/40">Audio Recordings</h3>
                    <span className="text-xs bg-white/[0.06] px-2 py-0.5 rounded font-mono text-[#F5F5F0]/70">{libraryFiles.filter(f => f.type === 'audio').length}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar grid grid-cols-1 gap-2.5 content-start">
                    {libraryFiles.filter(f => f.type === 'audio').map((file) => (
                      <div key={file.id} className="group bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.04] hover:border-white/10 rounded-xl p-3.5 transition-all flex items-center justify-between">
                        <div className="flex items-center gap-3 truncate">
                          <div className="w-8 h-8 bg-white/[0.06] rounded-lg flex items-center justify-center shrink-0">
                            <span className="text-[9px] font-black uppercase tracking-wider text-[#F5F5F0]/60">MP3</span>
                          </div>
                          <span className="truncate text-xs font-bold text-[#F5F5F0]/90">{file.name}</span>
                        </div>
                        <button 
                          onClick={(e) => handleDeleteFile(e, file.id)} 
                          className="opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-red-400 transition-all p-1.5"
                        >
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
            <div className="flex-1 flex flex-col overflow-hidden animate-in fade-in duration-300">
              <div className="flex-1 p-12 overflow-y-auto custom-scrollbar relative">
                <div className="max-w-4xl mx-auto py-6">
                  {isGenerating ? (
                    <div className="h-80 flex flex-col items-center justify-center space-y-5 bg-white/[0.02] border border-white/[0.06] rounded-3xl p-10">
                      <div className="w-12 h-12 border-2 border-white/20 border-t-[#F5F5F0] rounded-full animate-spin"></div>
                      <p className="text-xl font-bold tracking-tight text-center text-[#F5F5F0]">{generationStatus}</p>
                      <p className="text-[#F5F5F0]/40 text-xs font-bold uppercase tracking-widest">Please be patient, AI is processing chapters.</p>
                    </div>
                  ) : chapters.length > 0 && currentSegments.length > 0 ? (
                    <div className="bg-white/[0.02] border border-white/[0.04] p-10 rounded-3xl">
                      <div className="mb-8 pb-4 border-b border-white/[0.06]">
                        <h2 className="text-3xl font-black tracking-tight text-[#F5F5F0]">{activeChapterData?.title || `Chapter ${currentChapter}`}</h2>
                      </div>
                      <div className="text-2xl leading-[2.1] font-normal flex flex-wrap gap-x-[0.35em] gap-y-2 selection:bg-white/20">
                        {currentSegments.map((seg, idx) => {
                          const currentTime = audioRef.current?.currentTime || 0;
                          const isActive = currentTime >= seg.start && currentTime <= seg.end;
                          return (
                            <span 
                              key={idx} 
                              className={`transition-colors duration-100 ${
                                isActive 
                                  ? 'text-white font-medium' 
                                  : 'text-[#F5F5F0]/35'
                              }`}
                            >
                              {seg.text}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="h-80 flex flex-col items-center justify-center border border-dashed border-white/10 bg-white/[0.01] rounded-3xl p-10 gap-5">
                      <h3 className="text-lg font-black uppercase tracking-wider text-[#F5F5F0]">Configure Synchronization</h3>
                      <div className="flex flex-col sm:flex-row gap-3.5 w-full max-w-lg">
                        <button 
                          onClick={() => { setWizardMode('text-to-audio'); setIsWizardOpen(true); }} 
                          className="flex-1 bg-[#F5F5F0] text-[#081225] hover:bg-white p-4 rounded-xl font-bold text-xs uppercase tracking-wider transition-all"
                        >
                          Text to Audio (TTS)
                        </button>
                        <button 
                          onClick={() => { setWizardMode('audio-to-text'); setIsWizardOpen(true); }} 
                          className="flex-1 bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 p-4 rounded-xl font-bold text-xs uppercase tracking-wider transition-all text-[#F5F5F0]"
                        >
                          Audio to Text (STT)
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* CONTROL BAR */}
              <div className="h-24 bg-[#060d1b]/80 backdrop-blur-2xl border-t border-white/[0.06] px-10 flex items-center gap-6 shrink-0">
                <button 
                  disabled={currentChapter <= 1} 
                  onClick={() => handleChapterChange(Math.max(1, currentChapter - 1))} 
                  className={`w-10 h-10 rounded-xl bg-white/[0.04] border border-white/10 flex items-center justify-center transition-all font-bold text-sm shrink-0 ${
                    currentChapter <= 1 ? 'opacity-20 cursor-not-allowed' : 'hover:bg-white/10 text-[#F5F5F0]'
                  }`}
                >
                  ←
                </button>

                <div className="relative group shrink-0">
                  <button 
                    disabled={!currentAudioSrc}
                    onClick={() => setIsPlaying(!isPlaying)} 
                    className="w-12 h-12 rounded-xl bg-[#F5F5F0] text-[#081225] hover:bg-white flex items-center justify-center transition-all disabled:opacity-20 disabled:pointer-events-none"
                  >
                    {isPlaying ? (
                      <div className="flex gap-1">
                        <div className="w-1.5 h-4 bg-[#081225] rounded-full"></div>
                        <div className="w-1.5 h-4 bg-[#081225] rounded-full"></div>
                      </div>
                    ) : (
                      <div className="w-0 h-0 border-t-[6px] border-t-transparent border-l-[10px] border-l-[#081225] border-b-[6px] border-b-transparent ml-0.5"></div>
                    )}
                  </button>
                </div>

                <button 
                  disabled={currentChapter >= (chapters.length || 1)} 
                  onClick={() => handleChapterChange(Math.min(chapters.length || 1, currentChapter + 1))} 
                  className={`w-10 h-10 rounded-xl bg-white/[0.04] border border-white/10 flex items-center justify-center transition-all font-bold text-sm shrink-0 ${
                    currentChapter >= (chapters.length || 1) ? 'opacity-20 cursor-not-allowed' : 'hover:bg-white/10 text-[#F5F5F0]'
                  }`}
                >
                  →
                </button>

                <div className="flex-1 flex flex-col items-center gap-2">
                  <div 
                    onClick={handleSeek} 
                    className="w-full h-2 bg-white/[0.06] hover:bg-white/[0.1] rounded-full relative overflow-hidden cursor-pointer group transition-all"
                  >
                    <div 
                      className="absolute top-0 left-0 h-full bg-[#F5F5F0] transition-all duration-75 rounded-full" 
                      style={{ width: `${audioProgress}%` }}
                    ></div>
                  </div>
                  <div className="flex items-center justify-between w-full px-1">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#F5F5F0]/40">
                      Chapter {currentChapter} of {chapters.length || 1}
                    </span>
                    <span className="text-[10px] font-mono text-[#F5F5F0]/40">
                      {Math.round(audioProgress)}%
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* AI GENERATION WIZARD MODAL */}
      {isWizardOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-in fade-in duration-200">
          <div className="bg-[#081225] border border-white/10 p-7 rounded-3xl w-full max-w-md shadow-2xl">
            <h3 className="text-lg font-black uppercase tracking-tight mb-4 text-center text-[#F5F5F0]">
              {wizardMode === 'text-to-audio' ? "Select Text Document" : "Select Audio Recording"}
            </h3>

            <div className="mb-5">
              <label className="block text-[10px] font-black uppercase tracking-widest text-[#F5F5F0]/40 mb-2 pl-1">
                Target Language
              </label>
              <div className="flex bg-white/[0.03] p-1 rounded-xl border border-white/[0.06]">
                <button
                  type="button"
                  onClick={() => setSelectedLanguage('cs')}
                  className={`flex-1 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition-all ${
                    selectedLanguage === 'cs' ? 'bg-[#F5F5F0] text-[#081225]' : 'text-[#F5F5F0]/50 hover:text-[#F5F5F0]'
                  }`}
                >
                  Czech (CZ)
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedLanguage('en')}
                  className={`flex-1 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition-all ${
                    selectedLanguage === 'en' ? 'bg-[#F5F5F0] text-[#081225]' : 'text-[#F5F5F0]/50 hover:text-[#F5F5F0]'
                  }`}
                >
                  English (EN)
                </button>
              </div>
            </div>

            <div className="space-y-2 max-h-52 overflow-y-auto pr-1 custom-scrollbar">
              {libraryFiles
                .filter(f => f.type === (wizardMode === 'text-to-audio' ? 'text' : 'audio'))
                .map((file) => (
                  <div 
                    key={file.id} 
                    onClick={() => setSelectedFile(file)} 
                    className={`p-3.5 border rounded-xl cursor-pointer flex items-center gap-3 transition-all ${
                      selectedFile?.id === file.id 
                        ? 'border-white/30 bg-white/[0.08]' 
                        : 'border-white/[0.04] bg-white/[0.02] hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="w-7 h-7 rounded-md bg-white/[0.06] flex items-center justify-center shrink-0">
                      <span className="text-[8px] font-black uppercase tracking-wider text-[#F5F5F0]/60">
                        {wizardMode === 'text-to-audio' ? 'TXT' : 'MP3'}
                      </span>
                    </div>
                    <span className="font-bold text-xs truncate text-[#F5F5F0]/90">{file.name}</span>
                  </div>
                ))}
            </div>

            <div className="flex gap-2.5 mt-6">
              <button 
                onClick={() => { setIsWizardOpen(false); setSelectedFile(null); }} 
                className="flex-1 py-3 rounded-xl border border-white/10 hover:bg-white/[0.04] font-bold uppercase text-[10px] tracking-widest text-[#F5F5F0]/70"
              >
                Cancel
              </button>
              <button 
                disabled={!selectedFile} 
                onClick={handleStartGeneration} 
                className="flex-1 py-3 rounded-xl bg-[#F5F5F0] text-[#081225] font-black uppercase text-[10px] tracking-widest hover:bg-white transition-all disabled:opacity-30 disabled:pointer-events-none"
              >
                Start AI Sync
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}