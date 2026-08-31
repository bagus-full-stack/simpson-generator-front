"use client";

import { useState, useEffect, useRef } from "react";
import {
  Download, Sparkles, Loader2, AlertCircle, X, Clock, Zap,
  Image as ImageIcon, Type, Box, Eraser, RotateCcw, Maximize2,
  Trash2, Lightbulb, ChevronLeft, ChevronRight, Camera
} from "lucide-react";
import { type Job, submitTextJob, submitImageJob, pollJob, listJobs, downloadImage } from "./lib/api";

interface GeneratedImage { id: string; url: string; prompt: string; timestamp: number; duration: string; }

function jobToGalleryImage(job: Job): GeneratedImage {
  return {
    id: job.id,
    url: job.image_url ?? "",
    prompt: job.prompt,
    timestamp: new Date(job.created_at).getTime(),
    duration: job.duration_ms != null ? (job.duration_ms / 1000).toFixed(2) : "N/A",
  };
}

const ITEMS_PER_PAGE = 6;

const SUGGESTIONS = [
  "Elon Musk", "Walter White", "Batman", "Marilyn Monroe",
  "Un chat mignon", "Zombie apocalyptique", "Harry Potter", "Un Alien touriste"
];

export default function Home() {
  const [gallery, setGallery] = useState<GeneratedImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);
  const [isTurbo, setIsTurbo] = useState(false);

  // Modes
  const [mode, setMode] = useState<"text" | "image" | "pose" | "inpaint">("text");
  const [prompt, setPrompt] = useState("");
  const [steps, setSteps] = useState(30);
  const [strength, setStrength] = useState(0.75);

  // États Fichiers
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // États Caméra
  const [isCameraOpen, setIsCameraOpen] = useState(false);
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

  useEffect(() => {
    listJobs().then(jobs => setGallery(jobs.map(jobToGalleryImage))).catch(console.error);
    return () => stopCamera();
  }, []);

  // --- LOGIQUE CAMÉRA ---
  const startCamera = async () => {
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      streamRef.current = stream;
      setIsCameraOpen(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      }, 100);
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

  // --- FONCTIONS EXISTANTES ---
  const deleteImage = (idToDelete: string) => {
    setGallery((prev) => prev.filter((img) => img.id !== idToDelete));
    if (selectedImage?.id === idToDelete) setSelectedImage(null);
    if (currentImages.length === 1 && currentPage > 1) setCurrentPage(prev => prev - 1);
  };

  // --- NOUVELLE LOGIQUE DE DESSIN (Plus précise) ---

  // Fonction utilitaire pour dessiner un point
  const drawDot = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
    ctx.fillStyle = "rgba(255, 255, 255, 0.8)"; // Couleur du masque (blanc semi-transparent)
    ctx.beginPath();
    // Dessine un cercle plein exactement sous la souris
    ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  const startDrawing = (e: React.MouseEvent) => {
    setIsDrawing(true);
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;

    // Dessine un point immédiatement au clic
    drawDot(ctx, e.nativeEvent.offsetX, e.nativeEvent.offsetY);
  };

  const draw = (e: React.MouseEvent) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;

    // Dessine des points pendant le déplacement
    drawDot(ctx, e.nativeEvent.offsetX, e.nativeEvent.offsetY);
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      setTimeout(clearCanvas, 100);
    }
  };

  const generate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!prompt) return setError("Veuillez entrer une description.");
    if (mode !== "text" && !selectedFile) return setError("Veuillez choisir une image.");

    setLoading(true);
    setError(null);

    try {
      let job: Job;

      if (mode === "text") {
        job = await submitTextJob(prompt, steps, isTurbo);
      } else {
        const formData = new FormData();
        formData.append("prompt", prompt);
        formData.append("steps", steps.toString());
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

      const finished = await pollJob(job.id);
      if (finished.status !== "done" || !finished.image_url) {
        throw new Error(finished.error || "La génération a échoué.");
      }

      setGallery(prev => [jobToGalleryImage(finished), ...prev]);
      setCurrentPage(1);
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
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm animate-in fade-in">
              <div className="relative max-w-5xl w-full flex flex-col items-center">
                <button onClick={() => setSelectedImage(null)} className="absolute -top-12 right-0 text-white hover:text-red-400"><X size={40}/></button>
                <img src={selectedImage.url} className="rounded-lg max-h-[80vh] object-contain border-4 border-white shadow-2xl"/>
                <div className="mt-6 flex gap-4">
                  <div className="text-white font-bold bg-white/20 px-4 py-2 rounded-full flex gap-2 items-center">
                    <Clock size={18}/> {selectedImage.duration}s
                  </div>
                  <button onClick={() => downloadImage(selectedImage.url, `simpson-${selectedImage.prompt}.png`)} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-full font-bold flex items-center gap-2 transition-colors">
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
              <h1 className="text-3xl font-black mb-6 uppercase tracking-wider">Simpsons Maker</h1>

              {/* SÉLECTEUR DE MODE */}
              <div className="grid grid-cols-4 bg-slate-100 p-1 rounded-xl mb-6 gap-1">
                {[
                  { id: "text", icon: Type, label: "Texte", color: "text-blue-600" },
                  { id: "image", icon: ImageIcon, label: "Img2Img", color: "text-purple-600" },
                  { id: "pose", icon: Box, label: "Struct.", color: "text-rose-600" },
                  { id: "inpaint", icon: Eraser, label: "Edit", color: "text-green-600" },
                ].map((m) => (
                    <button
                        key={m.id} onClick={() => { setMode(m.id as any); stopCamera(); }}
                        className={`flex flex-col md:flex-row items-center justify-center gap-1 py-2 rounded-lg font-bold text-xs md:text-sm transition-all ${mode === m.id ? `bg-white ${m.color} shadow-sm` : "text-slate-400"}`}
                    >
                      <m.icon size={16}/> <span className="hidden sm:inline">{m.label}</span>
                    </button>
                ))}
              </div>

              <form onSubmit={generate} className="space-y-5">
                <div>
                  <label className="block font-bold mb-1 text-sm">{mode === "inpaint" ? "Ce qu'il faut dessiner à la place" : "Description"}</label>
                  <input
                      value={prompt} onChange={(e) => setPrompt(e.target.value)}
                      placeholder={mode === "inpaint" ? "Ex: A red cap, sunglasses..." : "Description..."}
                      className="w-full p-3 border-2 border-slate-300 rounded-xl focus:border-slate-900 outline-none font-medium"
                  />

                  <div className="mt-2">
                    <p className="text-xs font-bold text-slate-400 mb-2 flex items-center gap-1"><Lightbulb size={12} /> Idées rapides :</p>
                    <div className="flex flex-wrap gap-2">
                      {SUGGESTIONS.map((s) => (
                          <button key={s} type="button" onClick={() => setPrompt(s)} className="bg-slate-50 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 border border-slate-200 text-slate-500 text-[10px] font-bold py-1 px-2 rounded-full transition-all active:scale-95">{s}</button>
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
                                <button type="button" onClick={stopCamera} className="bg-red-500 p-2 rounded-full text-white shadow-lg"><X size={20}/></button>
                                <button type="button" onClick={capturePhoto} className="bg-white p-4 rounded-full text-black shadow-lg border-4 border-slate-200 active:scale-95 transition-transform"><Camera size={24}/></button>
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
                                  <img src={previewUrl} className="absolute inset-0 w-full h-full object-cover pointer-events-none"/>

                                  {mode === "inpaint" && (
                                      <>
                                        {/* Le Canvas : curseur caché */}
                                        <canvas
                                            ref={canvasRef} width={512} height={512}
                                            className="absolute inset-0 w-full h-full touch-none cursor-none"
                                            onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseLeave={stopDrawing}
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
                                    <button type="button" onClick={() => startCamera()} className="bg-black/50 text-white p-2 rounded-full hover:bg-black/80"><Camera size={16}/></button>
                                    <button type="button" onClick={() => fileInputRef.current?.click()} className="bg-black/50 text-white p-2 rounded-full hover:bg-black/80"><RotateCcw size={16}/></button>
                                  </div>
                                </div>
                            ) : (
                                <div className="p-8 flex flex-col items-center justify-center gap-4 h-64">
                                  <div className="flex gap-4">
                                    <button type="button" onClick={() => fileInputRef.current?.click()} className="flex flex-col items-center justify-center bg-white p-4 rounded-xl shadow-sm hover:shadow-md border border-slate-200 transition-all w-24 h-24">
                                      <ImageIcon size={24} className="mb-2 text-slate-500"/>
                                      <span className="text-[10px] font-bold text-slate-600">Galerie</span>
                                    </button>
                                    <button type="button" onClick={startCamera} className="flex flex-col items-center justify-center bg-white p-4 rounded-xl shadow-sm hover:shadow-md border border-slate-200 transition-all w-24 h-24">
                                      <Camera size={24} className="mb-2 text-slate-500"/>
                                      <span className="text-[10px] font-bold text-slate-600">Caméra</span>
                                    </button>
                                  </div>
                                  <span className="text-xs text-slate-400 font-bold">ou glissez une image ici</span>
                                </div>
                            )
                        )}
                      </div>

                      {mode === "image" && (
                          <div className="mt-4">
                            <span className="text-xs font-bold">Ressemblance ({Math.round(strength*100)}%)</span>
                            <input type="range" min="0.1" max="0.9" step="0.05" value={strength} onChange={(e) => setStrength(parseFloat(e.target.value))} className="w-full accent-purple-500"/>
                          </div>
                      )}
                      {mode === "inpaint" && !isCameraOpen && (
                          <div className="mt-4">
                            <span className="text-xs font-bold">Taille du Pinceau ({brushSize}px)</span>
                            <input type="range" min="5" max="50" value={brushSize} onChange={(e) => setBrushSize(parseInt(e.target.value))} className="w-full accent-green-500"/>
                            <p className="text-[10px] text-green-700 mt-1 font-bold text-center">Le cercle montre la zone exacte qui sera modifiée.</p>
                          </div>
                      )}
                    </div>
                )}

                <hr className="border-slate-100"/>
                <div className={`p-3 rounded-xl border-2 cursor-pointer flex justify-between items-center ${isTurbo ? 'bg-yellow-100 border-yellow-500' : 'bg-slate-50 border-slate-200'}`} onClick={() => setIsTurbo(!isTurbo)}>
                  <div className="flex items-center gap-2">
                    <div className={`p-1.5 rounded-full ${isTurbo ? 'bg-yellow-500 text-black' : 'bg-slate-200 text-slate-400'}`}><Zap size={16} fill={isTurbo?"black":"none"}/></div>
                    <div className="text-xs uppercase font-bold">Mode Turbo</div>
                  </div>
                  <div className={`w-8 h-4 rounded-full p-0.5 ${isTurbo ? 'bg-black' : 'bg-slate-300'}`}><div className={`bg-white w-3 h-3 rounded-full transition-transform ${isTurbo ? 'translate-x-4' : ''}`}/></div>
                </div>

                <button
                    disabled={loading || !prompt || (mode !== "text" && !selectedFile)}
                    className={`w-full text-white font-black py-4 rounded-xl shadow-[0_4px_0_rgba(0,0,0,0.2)] active:translate-y-1 transition-all flex justify-center gap-2 ${
                        mode === "image" ? "bg-purple-600 hover:bg-purple-700" :
                            mode === "pose" ? "bg-rose-600 hover:bg-rose-700" :
                                mode === "inpaint" ? "bg-green-600 hover:bg-green-700" :
                                    "bg-blue-600 hover:bg-blue-700"
                    }`}
                >
                  {loading ? <Loader2 className="animate-spin"/> : <Sparkles/>}
                  {loading ? "GÉNÉRER" : "GÉNÉRER"}
                </button>
              </form>
              {error && <div className="mt-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm font-bold flex gap-2"><AlertCircle size={16}/>{error}</div>}
            </div>
          </div>

          {/* GALERIE AVEC PAGINATION */}
          <div className="lg:col-span-2">
            <div className="bg-white/90 backdrop-blur p-6 rounded-3xl border-4 border-slate-900 min-h-[600px] flex flex-col justify-between">
              <div>
                <h2 className="text-2xl font-black mb-6 flex items-center gap-2">📸 Galerie ({gallery.length})</h2>
                {gallery.length === 0 ? (
                    <div className="h-64 flex flex-col items-center justify-center text-slate-400 border-4 border-dashed border-slate-300 rounded-3xl bg-slate-50/50">
                      <Sparkles size={48} className="mb-4 opacity-30" />
                      <p className="font-bold">Galerie vide</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {currentImages.map(img => (
                          <div key={img.id} onClick={() => setSelectedImage(img)} className="relative group bg-white p-2 rounded-xl border-2 border-slate-200 hover:border-blue-500 cursor-pointer transition-all hover:-translate-y-1 hover:shadow-xl">
                            <div className="absolute top-3 left-3 z-10 bg-black/60 text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex gap-1 backdrop-blur"><Clock size={10}/> {img.duration}s</div>
                            <img src={img.url} className="w-full aspect-square object-cover rounded-lg bg-slate-100"/>
                            <div className="absolute inset-0 bg-slate-900/80 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl flex flex-col items-center justify-center p-3 text-white backdrop-blur-sm pointer-events-none">
                              <p className="text-xs font-bold text-center mb-4 uppercase tracking-wide line-clamp-2">{img.prompt}</p>
                              <div className="flex gap-2 pointer-events-auto">
                                <button onClick={(e) => {e.stopPropagation(); setSelectedImage(img)}} className="bg-white text-blue-600 p-2 rounded-full hover:bg-blue-100"><Maximize2 size={18} /></button>
                                <button onClick={(e) => {e.stopPropagation(); downloadImage(img.url, `simpson-${img.prompt}.png`)}} className="bg-white text-slate-900 p-2 rounded-full hover:bg-green-400"><Download size={18} /></button>
                                <button onClick={(e) => {e.stopPropagation(); deleteImage(img.id)}} className="bg-white text-red-500 p-2 rounded-full hover:bg-red-500"><Trash2 size={18} /></button>
                              </div>
                            </div>
                          </div>
                      ))}
                    </div>
                )}
              </div>
              {gallery.length > ITEMS_PER_PAGE && (
                  <div className="flex justify-center items-center gap-4 mt-8 pt-6 border-t border-slate-200">
                    <button onClick={prevPage} disabled={currentPage === 1} className="p-2 rounded-full bg-slate-100 hover:bg-blue-100 disabled:opacity-30"><ChevronLeft size={24}/></button>
                    <span className="font-bold text-slate-500 text-sm">Page {currentPage} / {totalPages}</span>
                    <button onClick={nextPage} disabled={currentPage === totalPages} className="p-2 rounded-full bg-slate-100 hover:bg-blue-100 disabled:opacity-30"><ChevronRight size={24}/></button>
                  </div>
              )}
            </div>
          </div>
        </div>
      </main>
  );
}