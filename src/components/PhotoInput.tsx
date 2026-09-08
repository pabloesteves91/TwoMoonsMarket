import { useEffect, useRef, useState } from 'react';
import { repo } from '../db';
import { resizeImage, uid } from '../lib/format';

interface PhotoInputProps {
  photoId?: string;
  onChange: (photoId: string | undefined) => void;
}

/**
 * Foto pro Karte: am Handy öffnet der Button direkt die Kamera.
 * Bilder werden auf 900 px skaliert und als JPEG-Data-URL in IndexedDB abgelegt.
 */
export default function PhotoInput({ photoId, onChange }: PhotoInputProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    if (!photoId) {
      setPreview(null);
      return;
    }
    void repo.getPhoto(photoId).then((photo) => {
      if (active) setPreview(photo?.dataUrl ?? null);
    });
    return () => {
      active = false;
    };
  }, [photoId]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await resizeImage(file);
      const id = photoId ?? uid('photo_');
      await repo.savePhoto({ id, dataUrl, createdAt: Date.now() });
      setPreview(dataUrl);
      onChange(id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function remove() {
    if (photoId) await repo.deletePhoto(photoId);
    setPreview(null);
    onChange(undefined);
  }

  return (
    <div>
      <span className="field__label">Foto</span>
      <div className="row">
        {preview ? (
          <img className="thumb thumb--lg" src={preview} alt="Kartenfoto" />
        ) : (
          <div className="thumb thumb--lg thumb--empty" aria-hidden>
            ▦
          </div>
        )}
        <div className="stack" style={{ gap: 8 }}>
          <button
            type="button"
            className="btn btn--sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? 'Lädt …' : preview ? 'Foto ersetzen' : 'Foto aufnehmen / wählen'}
          </button>
          {preview ? (
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => void remove()}>
              Entfernen
            </button>
          ) : null}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      {error ? <p className="notice notice--error" style={{ marginTop: 8 }}>{error}</p> : null}
    </div>
  );
}
