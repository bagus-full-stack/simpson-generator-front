"use client";

import { useState, useEffect, useRef } from "react";
import {
  Download, Sparkles, Loader2, AlertCircle, X, Clock, Zap,
  Image as ImageIcon, Type, Box, Eraser, RotateCcw, Maximize2,
  Lightbulb, ChevronLeft, ChevronRight, Camera, Link2, SwitchCamera,
  type LucideIcon
} from "lucide-react";
import { type Job, submitTextJob, submitImageJob, pollJob, listJobs, downloadImage, getClientId, adoptClientId } from "./lib/api";

type Mode = "text" | "image" | "pose" | "inpaint";

interface GeneratedImage { id: string; url: string; prompt: string; timestamp: number; duration: string; }

interface ModeOption { id: Mode; icon: LucideIcon; label: string; hint: string; }

const MODES: ModeOption[] = [
  { id: "text", icon: Type, label: "Texte", hint: "Décris un personnage, il devient un Simpson." },
  { id: "image", icon: ImageIcon, label: "Ma photo", hint: "Ta photo devient un personnage des Simpsons." },
  { id: "pose", icon: Box, label: "Pose", hint: "Garde la pose de ta photo, change le personnage." },
  { id: "inpaint", icon: Eraser, label: "Retouche", hint: "Peins la zone de la photo à remplacer." },
];

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")}`;
}

function jobToGalleryImage(job: Job): GeneratedImage {
  return {
    id: job.id,
    url: job.image_url ?? "",
    prompt: job.prompt,
    timestamp: new Date(job.created_at).getTime(),
    duration: job.duration_ms != null ? formatDuration(job.duration_ms) : "—",
  };
}

// Job en cours : on le retient pour reprendre l'attente après un rechargement ou un onglet endormi sur mobile.
// La galerie perso, elle, est filtrée par le back via l'identifiant client (voir api.ts::getClientId).
const PENDING_KEY = "simpsons.pending";
function rememberJob(id: string) {
  try { localStorage.setItem(PENDING_KEY, id); } catch { /* reprise impossible sans stockage */ }
}
function clearPending() {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* idem */ }
}

const ITEMS_PER_PAGE = 6;
const STEPS = 30; // ignoré en mode turbo (toujours 6 étapes côté serveur)

// En anglais : le modèle est entraîné sur des prompts anglais.
const SUGGESTIONS = [
  "Elon Musk", "Walter White", "Batman", "Marilyn Monroe",
  "A cute cat", "Zombie apocalypse", "Harry Potter", "A tourist alien"
];

export default function Home() {
  const [gallery, setGallery] = useState<GeneratedImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);
  const [isTurbo, setIsTurbo] = useState(true);

  // Modes
  const [mode, setMode] = useState<Mode>("text");
  const [prompt, setPrompt] = useState("");
  const [strength, setStrength] = useState(0.75);

  // États Fichiers
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // États Caméra
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [linkCopied, setLinkCopied] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // États Canvas (Inpaint) et Curseur
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null); // Nouveau ref pour le conteneur
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(20);
  // Nouvel état pour suivre la position du curseur personnalisé
  const [cursorPos, setCursorPos] = useState<{ x: number, y: number } | null>(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);

  // Temps écoulé pendant une génération (un job dure plusieurs minutes sur un serveur CPU).
  const [elapsed, setElapsed] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  useEffect(() => {
    if (!loading) return;
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [loading]);
  const elapsedLabel = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  // --- LOGIQUE CAMÉRA ---
  const startCamera = async (facing: "user" | "environment" = "user") => {
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing } } });
      streamRef.current = stream;
      setFacing(facing);
      setIsCameraOpen(true);
    } catch (err) {
      console.error("Erreur caméra:", err);
      setError("Impossible d'accéder à la caméra.");
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraOpen(false);
  };

  // Attend la fin d'un job, l'ajoute à la galerie ; lève une erreur lisible sinon.
  const finishJob = async (id: string) => {
    try {
      const finished = await pollJob(id);
      if (finished.status !== "done" || !finished.image_url) {
        throw new Error(finished.error || "La génération a échoué.");
      }
      setGallery(prev => prev.some(g => g.id === id) ? prev : [jobToGalleryImage(finished), ...prev]);
      setCurrentPage(1);
    } finally {
      clearPending();
    }
  };

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    if (code) {
      adoptClientId(code);
      window.history.replaceState(null, "", window.location.pathname);
    }
    let pending: string | null = null;
    try { pending = localStorage.getItem(PENDING_KEY); } catch { /* idem */ }
    listJobs().then(jobs => {
      setGallery(jobs.map(jobToGalleryImage));
      if (pending) {
        // Reprise après rechargement ou onglet endormi : on reprend l'attente du job en cours.
        setLoading(true);
        finishJob(pending)
          .catch(err => setError(err instanceof Error ? err.message : "Erreur de génération."))
          .finally(() => setLoading(false));
      }
    }).catch(console.error);
    return () => stopCamera();
  }, []);

  // Le <video> n'existe qu'après le rendu : on y branche le flux une fois la caméra ouverte.
  useEffect(() => {
    if (isCameraOpen && videoRef.current) videoRef.current.srcObject = streamRef.current;
  }, [isCameraOpen]);

  // Libère l'ancien aperçu (blob) quand l'image change, et à la fermeture de la page.
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedImage(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const capturePhoto = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], "camera_capture.png", { type: "image/png" });
        setSelectedFile(file);
        setPreviewUrl(URL.createObjectURL(file));
        stopCamera();
      }
    }, "image/png");
  };

  // --- LOGIQUE PAGINATION ---
  const indexOfLastImage = currentPage * ITEMS_PER_PAGE;
  const indexOfFirstImage = indexOfLastImage - ITEMS_PER_PAGE;
  const currentImages = gallery.slice(indexOfFirstImage, indexOfLastImage);
  const totalPages = Math.ceil(gallery.length / ITEMS_PER_PAGE);

  const nextPage = () => { if (currentPage < totalPages) setCurrentPage(prev => prev + 1); };
  const prevPage = () => { if (currentPage > 1) setCurrentPage(prev => prev - 1); };

  // --- LOGIQUE DE DESSIN (masque inpaint) ---

  // Le canvas fait 512x512 en interne mais s'affiche plus petit : k convertit pixels affichés -> pixels du canvas.
  const drawDot = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const k = canvas.width / canvas.clientWidth;
    ctx.fillStyle = "rgba(255, 255, 255, 0.8)"; // Couleur du masque (blanc semi-transparent)
    ctx.beginPath();
    ctx.arc(e.nativeEvent.offsetX * k, e.nativeEvent.offsetY * k, (brushSize * k) / 2, 0, Math.PI * 2);
    ctx.fill();
  };

  const startDrawing = (e: React.PointerEvent) => {
    setIsDrawing(true);
    drawDot(e); // point immédiat au clic
  };

  const draw = (e: React.PointerEvent) => {
    if (isDrawing) drawDot(e);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  // Gère le mouvement de la souris pour le curseur personnalisé
  const handleMouseMoveCanvasContainer = (e: React.MouseEvent) => {
    if (!canvasContainerRef.current) return;
    const rect = canvasContainerRef.current.getBoundingClientRect();
    setCursorPos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    });
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const getMaskBlob = async () => {
    if (!canvasRef.current) return null;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 512; tempCanvas.height = 512;
    const ctx = tempCanvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = "black"; ctx.fillRect(0, 0, 512, 512);
    ctx.drawImage(canvasRef.current, 0, 0, 512, 512);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, 512, 512);
    return new Promise<Blob | null>(resolve => tempCanvas.toBlob(resolve));
  };

  const loadFile = (file: File) => {
    if (!file.type.startsWith("image/")) return setError("Le fichier doit être une image.");
    setError(null);
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setTimeout(clearCanvas, 100);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) loadFile(e.target.files[0]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
  };

  const generate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = prompt.trim();
    if (!text) return setError("Veuillez entrer une description.");
    if (mode !== "text" && !selectedFile) return setError("Veuillez choisir une image.");

    setElapsed(0);
    setLoading(true);
    setError(null);

    try {
      let job: Job;

      if (mode === "text") {
        job = await submitTextJob(text, STEPS, isTurbo);
      } else {
        const formData = new FormData();
        formData.append("prompt", text);
        formData.append("steps", STEPS.toString());
        formData.append("turbo_mode", isTurbo.toString());

        if (mode === "image") {
          formData.append("file", selectedFile!);
          formData.append("strength", strength.toString());
          job = await submitImageJob("img2img", formData);
        } else if (mode === "pose") {
          formData.append("file", selectedFile!);
          job = await submitImageJob("pose", formData);
        } else {
          formData.append("image_file", selectedFile!);
          const maskBlob = await getMaskBlob();
          if (!maskBlob) throw new Error("Erreur masque");
          formData.append("mask_file", maskBlob, "mask.png");
          job = await submitImageJob("inpaint", formData);
        }
      }

      rememberJob(job.id);
      await finishJob(job.id);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Erreur de génération.");
    } finally {
      setLoading(false);
    }
  };

  return (
      <main className="min-h-screen bg-yellow-400 p-4 md:p-8 font-sans text-slate-900">

        {/* MODALE ZOOM */}
        {selectedImage && (
            <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm animate-in fade-in">
              <div className="relative max-w-5xl w-full flex flex-col items-center">
                <button onClick={() => setSelectedImage(null)} aria-label="Fermer" className="absolute -top-12 right-0 text-white hover:text-red-400"><X size={40}/></button>
                <img src={selectedImage.url} alt={selectedImage.prompt} className="rounded-lg max-h-[80vh] object-contain border-4 border-white shadow-2xl"/>
                <div className="mt-6 flex gap-4">
                  <div className="text-white font-bold bg-white/20 px-4 py-2 rounded-full flex gap-2 items-center">
                    <Clock size={18}/> {selectedImage.duration}
                  </div>
                  <button onClick={() => downloadImage(selectedImage.url, `simpson-${selectedImage.prompt}.png`)} className="bg-yellow-400 hover:bg-yellow-300 text-slate-900 px-6 py-3 rounded-full font-bold flex items-center gap-2 transition-colors">
                    <Download size={20}/> Télécharger HD
                  </button>
                </div>
              </div>
            </div>
        )}

        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* CONTROLES */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white p-6 rounded-3xl shadow-xl border-4 border-slate-900">
              <h1 className="text-3xl font-black mb-1 uppercase tracking-wider text-balance">Simpsons Maker</h1>
              <p className="text-sm text-slate-600 mb-6">Transforme un texte ou une photo en personnage des Simpsons.</p>

              {/* SÉLECTEUR DE MODE */}
              <div role="tablist" aria-label="Mode de génération" className="grid grid-cols-4 bg-slate-100 p-1 rounded-xl mb-2 gap-1">
                {MODES.map((m) => (
                    <button
                        key={m.id} role="tab" aria-selected={mode === m.id} type="button"
                        onClick={() => { setMode(m.id); stopCamera(); }}
                        className={`flex flex-col items-center justify-center gap-1 min-h-11 py-2 rounded-lg font-bold text-xs transition-all ${mode === m.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
                    >
                      <m.icon size={16}/> <span>{m.label}</span>
                    </button>
                ))}
              </div>
              <p className="text-sm text-slate-600 mb-6">{MODES.find((m) => m.id === mode)?.hint}</p>

              <form onSubmit={generate} className="space-y-5">
                <div>
                  <label htmlFor="prompt" className="block font-bold mb-1 text-sm">{mode === "inpaint" ? "Ce qu'il faut dessiner à la place" : "Description (en anglais de préférence)"}</label>
                  <input
                      id="prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={300}
                      placeholder={mode === "inpaint" ? "Ex: A red cap, sunglasses..." : "Ex: Batman, A cute cat..."}
                      className="w-full p-3 border-2 border-slate-300 rounded-xl focus:border-slate-900 outline-none font-medium"
                  />

                  <div className="mt-2">
                    <p className="text-xs font-bold text-slate-600 mb-2 flex items-center gap-1"><Lightbulb size={12} /> Idées rapides :</p>
                    <div className="flex flex-wrap gap-2">
                      {SUGGESTIONS.map((s) => (
                          <button key={s} type="button" onClick={() => setPrompt(s)} className="bg-slate-50 hover:bg-yellow-100 hover:border-slate-900 border border-slate-300 text-slate-700 text-xs font-bold min-h-11 px-3 rounded-full transition-all active:scale-95">{s}</button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* ZONE IMAGE / CAMERA */}
                {mode !== "text" && (
                    <div className="animate-in fade-in slide-in-from-top-4">
                      <div className="flex justify-between items-end mb-1">
                        <label className="block font-bold text-sm">Image Source</label>
                        {mode === "inpaint" && previewUrl && !isCameraOpen && (
                            <button type="button" onClick={clearCanvas} className="text-xs flex items-center gap-1 text-slate-500 hover:text-red-500 font-bold"><RotateCcw size={12}/> Effacer tracé</button>
                        )}
                      </div>

                      <div className={`relative border-2 border-dashed rounded-xl overflow-hidden bg-slate-50 ${(!previewUrl && !isCameraOpen) ? 'border-slate-300' : 'border-slate-900 border-solid'}`}>

                        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden"/>

                        {isCameraOpen ? (
                            <div className="relative aspect-square bg-black">
                              <video ref={videoRef} className="w-full h-full object-cover" autoPlay playsInline muted />
                              <div className="absolute bottom-4 left-0 right-0 flex justify-center items-center gap-4">
                                <button type="button" onClick={stopCamera} aria-label="Fermer la caméra" className="bg-red-500 p-3 rounded-full text-white shadow-lg"><X size={20}/></button>
                                <button type="button" onClick={capturePhoto} aria-label="Prendre la photo" className="bg-white p-4 rounded-full text-black shadow-lg border-4 border-slate-200 active:scale-95 transition-transform"><Camera size={24}/></button>
                                <button type="button" onClick={() => startCamera(facing === "user" ? "environment" : "user")} aria-label="Changer de caméra" className="bg-white p-3 rounded-full text-black shadow-lg"><SwitchCamera size={20}/></button>
                              </div>
                            </div>
                        ) : (
                            previewUrl ? (
                                // --- MODIFICATION ICI POUR LE CURSEUR ---
                                <div
                                    ref={canvasContainerRef}
                                    className="relative w-full aspect-square overflow-hidden"
                                    onMouseMove={handleMouseMoveCanvasContainer}
                                    onMouseEnter={() => setCursorPos({x:0, y:0})} // Active le curseur
                                    onMouseLeave={() => setCursorPos(null)} // Désactive le curseur
                                >
                                  <img src={previewUrl} alt="Aperçu de l'image source" className="absolute inset-0 w-full h-full object-cover pointer-events-none"/>

                                  {mode === "inpaint" && (
                                      <>
                                        {/* Le Canvas : curseur caché */}
                                        <canvas
                                            ref={canvasRef} width={512} height={512}
                                            className="absolute inset-0 w-full h-full touch-none cursor-none"
                                            onPointerDown={startDrawing} onPointerMove={draw} onPointerUp={stopDrawing} onPointerLeave={stopDrawing}
                                        />

                                        {/* Le Curseur Personnalisé (Cercle blanc) */}
                                        {cursorPos && (
                                            <div
                                                className="pointer-events-none absolute border-2 border-white bg-white/30 rounded-full transform -translate-x-1/2 -translate-y-1/2"
                                                style={{
                                                  left: cursorPos.x,
                                                  top: cursorPos.y,
                                                  width: brushSize,
                                                  height: brushSize,
                                                }}
                                            />
                                        )}
                                      </>
                                  )}

                                  <div className="absolute bottom-2 right-2 flex gap-2">
                                    <button type="button" onClick={() => startCamera()} aria-label="Utiliser la caméra" className="bg-black/50 text-white p-2 rounded-full hover:bg-black/80"><Camera size={16}/></button>
                                    <button type="button" onClick={() => fileInputRef.current?.click()} aria-label="Changer d'image" className="bg-black/50 text-white p-2 rounded-full hover:bg-black/80"><RotateCcw size={16}/></button>
                                  </div>
                                </div>
                            ) : (
                                <div
                                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                                    onDragLeave={() => setIsDragging(false)}
                                    onDrop={handleDrop}
                                    className={`p-8 flex flex-col items-center justify-center gap-4 h-64 transition-colors ${isDragging ? "bg-yellow-100" : ""}`}
                                >
                                  <div className="flex gap-4">
                                    <button type="button" onClick={() => fileInputRef.current?.click()} className="flex flex-col items-center justify-center bg-white p-4 rounded-xl shadow-sm hover:shadow-md border border-slate-300 transition-all w-24 h-24">
                                      <ImageIcon size={24} className="mb-2 text-slate-600"/>
                                      <span className="text-xs font-bold text-slate-700">Fichier</span>
                                    </button>
                                    <button type="button" onClick={() => startCamera()} className="flex flex-col items-center justify-center bg-white p-4 rounded-xl shadow-sm hover:shadow-md border border-slate-300 transition-all w-24 h-24">
                                      <Camera size={24} className="mb-2 text-slate-600"/>
                                      <span className="text-xs font-bold text-slate-700">Caméra</span>
                                    </button>
                                  </div>
                                  <span className="text-xs text-slate-600 font-bold">ou glissez une image ici</span>
                                </div>
                            )
                        )}
                      </div>

                      {mode === "image" && (
                          <div className="mt-4">
                            <label htmlFor="strength" className="text-xs font-bold">Liberté du modèle ({Math.round(strength*100)}%)</label>
                            <p className="text-xs text-slate-600">Plus c&apos;est haut, plus le résultat s&apos;éloigne de ta photo.</p>
                            <input id="strength" type="range" min="0.1" max="0.9" step="0.05" value={strength} onChange={(e) => setStrength(parseFloat(e.target.value))} className="w-full accent-slate-900"/>
                          </div>
                      )}
                      {mode === "inpaint" && !isCameraOpen && (
                          <div className="mt-4">
                            <label htmlFor="brush" className="text-xs font-bold">Taille du pinceau ({brushSize}px)</label>
                            <input id="brush" type="range" min="5" max="50" value={brushSize} onChange={(e) => setBrushSize(parseInt(e.target.value))} className="w-full accent-slate-900"/>
                            <p className="text-xs text-slate-700 mt-1 font-bold text-center">Le cercle montre la zone exacte qui sera modifiée.</p>
                          </div>
                      )}
                    </div>
                )}

                <hr className="border-slate-100"/>
                <button
                    type="button" role="switch" aria-checked={isTurbo} onClick={() => setIsTurbo(!isTurbo)}
                    className={`w-full text-left p-3 rounded-xl border-2 flex justify-between items-center ${isTurbo ? 'bg-yellow-100 border-yellow-500' : 'bg-slate-50 border-slate-300'}`}
                >
                  <span className="flex items-center gap-2">
                    <span className={`p-1.5 rounded-full ${isTurbo ? 'bg-yellow-500 text-black' : 'bg-slate-200 text-slate-600'}`}><Zap size={16} fill={isTurbo?"black":"none"}/></span>
                    <span>
                      <span className="block text-xs uppercase font-bold">Mode turbo</span>
                      <span className="block text-xs text-slate-600">{isTurbo ? "Plus rapide, qualité un peu moindre." : "Plus lent, meilleure qualité."}</span>
                    </span>
                  </span>
                  <span className={`w-8 h-4 rounded-full p-0.5 ${isTurbo ? 'bg-black' : 'bg-slate-400'}`}><span className={`block bg-white w-3 h-3 rounded-full transition-transform ${isTurbo ? 'translate-x-4' : ''}`}/></span>
                </button>

                <button
                    disabled={loading || !prompt.trim() || (mode !== "text" && !selectedFile)}
                    className="w-full bg-slate-900 hover:bg-slate-700 disabled:opacity-60 disabled:hover:bg-slate-900 text-yellow-400 font-black py-4 rounded-xl shadow-[0_4px_0_rgba(0,0,0,0.2)] active:translate-y-1 transition-all flex justify-center gap-2"
                >
                  {loading ? <Loader2 className="animate-spin"/> : <Sparkles/>}
                  {loading ? `GÉNÉRATION… ${elapsedLabel}` : "GÉNÉRER"}
                </button>
                {!loading && (!prompt.trim() || (mode !== "text" && !selectedFile)) && (
                    <p className="text-xs text-slate-600 text-center">
                      {mode !== "text" && !selectedFile ? "Ajoute une image et une description pour générer." : "Écris une description pour générer."}
                    </p>
                )}
              </form>
              <div role="status" aria-live="polite">
                {loading && (
                    <p className="mt-4 p-3 bg-yellow-100 border-2 border-yellow-500 rounded-lg text-sm font-bold">
                      Génération en cours ({elapsedLabel}). Cela peut prendre plusieurs minutes : garde cet onglet ouvert, l&apos;image apparaîtra dans la galerie.
                    </p>
                )}
              </div>
              {error && <div role="alert" className="mt-4 p-3 bg-red-100 text-red-800 rounded-lg text-sm font-bold flex gap-2"><AlertCircle size={16} className="shrink-0 mt-0.5"/>{error}</div>}
            </div>
          </div>

          {/* GALERIE AVEC PAGINATION */}
          <div className="lg:col-span-2">
            <div className="bg-white/90 backdrop-blur p-6 rounded-3xl border-4 border-slate-900 min-h-[600px] flex flex-col justify-between">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
                  <h2 className="text-2xl font-black flex items-center gap-2"><Camera size={24} aria-hidden="true" /> Mes créations ({gallery.length})</h2>
                  <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(`${window.location.origin}/?code=${getClientId()}`)
                            .then(() => { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2500); })
                            .catch(() => setError("Copie impossible : autorise l'accès au presse-papiers."));
                      }}
                      className="min-h-11 px-3 rounded-full border border-slate-300 bg-slate-50 hover:bg-yellow-100 text-xs font-bold flex items-center gap-1"
                  >
                    <Link2 size={14} aria-hidden="true" /> {linkCopied ? "Lien copié" : "Copier mon lien d'accès"}
                  </button>
                </div>
                {gallery.length === 0 && !loading ? (
                    <div className="h-64 flex flex-col items-center justify-center text-slate-600 border-4 border-dashed border-slate-300 rounded-3xl bg-slate-50/50">
                      <Sparkles size={48} className="mb-4 opacity-40" />
                      <p className="font-bold">Aucune image pour l&apos;instant</p>
                      <p className="text-sm">Écris une description puis lance ta première génération.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {loading && currentPage === 1 && (
                          <div className="bg-white p-2 rounded-xl border-2 border-dashed border-slate-900" aria-hidden="true">
                            <div className="w-full aspect-square rounded-lg bg-yellow-100 animate-pulse flex flex-col items-center justify-center gap-2 text-slate-900">
                              <Loader2 className="animate-spin" size={28}/>
                              <span className="font-black tabular-nums">{elapsedLabel}</span>
                            </div>
                            <p className="mt-2 text-xs font-bold text-slate-700">En cours…</p>
                          </div>
                      )}
                      {currentImages.map(img => (
                          <div key={img.id} className="relative group bg-white p-2 rounded-xl border-2 border-slate-300 hover:border-slate-900 transition-all hover:-translate-y-0.5 hover:shadow-xl">
                            <div className="absolute top-3 left-3 z-10 bg-black/70 text-white text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-1"><Clock size={12}/> {img.duration}</div>
                            <button type="button" onClick={() => setSelectedImage(img)} aria-label={`Agrandir : ${img.prompt}`} className="block w-full overflow-hidden rounded-lg">
                              <img src={img.url} alt="" className="w-full aspect-square object-cover bg-slate-100 transition-transform group-hover:scale-[1.03]"/>
                            </button>
                            <p className="mt-2 text-xs font-bold text-slate-700 line-clamp-1">{img.prompt}</p>
                            <div className="absolute bottom-10 right-3 flex gap-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                              <button type="button" onClick={() => setSelectedImage(img)} aria-label="Agrandir" className="bg-white text-slate-900 shadow p-3 rounded-full hover:bg-yellow-200"><Maximize2 size={20} /></button>
                              <button type="button" onClick={() => downloadImage(img.url, `simpson-${img.prompt}.png`)} aria-label="Télécharger" className="bg-white text-slate-900 shadow p-3 rounded-full hover:bg-yellow-200"><Download size={20} /></button>
                            </div>
                          </div>
                      ))}
                    </div>
                )}
              </div>
              {gallery.length > ITEMS_PER_PAGE && (
                  <div className="flex justify-center items-center gap-4 mt-8 pt-6 border-t border-slate-200">
                    <button onClick={prevPage} disabled={currentPage === 1} aria-label="Page précédente" className="p-3 rounded-full bg-slate-100 hover:bg-yellow-200 disabled:opacity-30"><ChevronLeft size={20}/></button>
                    <span className="font-bold text-slate-700 text-sm">Page {currentPage} / {totalPages}</span>
                    <button onClick={nextPage} disabled={currentPage === totalPages} aria-label="Page suivante" className="p-3 rounded-full bg-slate-100 hover:bg-yellow-200 disabled:opacity-30"><ChevronRight size={20}/></button>
                  </div>
              )}
            </div>
          </div>
        </div>
      </main>
  );
}