import { readStoredUser } from './auth';

/**
 * Chunked multipart upload of a recording into R2.
 *
 * Extracted from App.tsx so both the lobby (Recordings tab) and the in-meeting
 * audio recorder can use it — the two live in different components and would
 * otherwise each carry a copy of the three-call multipart dance.
 *
 * Two server flows, chosen by role, with identical wire shapes:
 *   Superadmin      -> /upload/*          (shared meeting-recordings bucket)
 *   Admin / founder -> /upload/direct/*   (the caller's OWN R2 bucket)
 * A single large PUT hits Cloudflare's per-request body limit and fails as a
 * bare "Failed to fetch", hence 8 MB parts in both cases.
 */

const API = 'https://api.vegvisr.org/realtime/recordings';
const CHUNK_SIZE = 8 * 1024 * 1024;

export interface UploadResult {
  ok: boolean;
  name?: string;
  key?: string;
  error?: string;
}

interface Options {
  /** 0-100, called after each part completes. */
  onProgress?: (pct: number) => void;
}

interface UploadSession {
  uploadId: string;
  key: string;
  name: string;
  size: number;
  contentType: string;
}

const canManage = (role: string | null | undefined) => {
  const n = (role || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  return n === 'admin' || n === 'superadmin';
};

/**
 * `base` is the endpoint prefix — '' for the shared flow, '/direct' for own-R2.
 * Everything else about the protocol is identical between the two.
 */
async function runMultipart(file: File, token: string, base: '' | '/direct', opts: Options): Promise<UploadResult> {
  let session: UploadSession | null = null;
  try {
    const initResp = await fetch(`${API}/upload${base}/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Token': token },
      body: JSON.stringify({
        filename: file.name,
        // Audio keeps its own type; only a typeless blob falls back to video.
        contentType: file.type || 'video/mp4',
        size: file.size,
      }),
    });
    const initData = await initResp.json();
    if (!initResp.ok || !initData.success) {
      throw new Error(initData.error || `Upload init failed with status ${initResp.status}`);
    }
    session = initData as UploadSession;

    const parts: Array<{ partNumber: number; etag: string }> = [];
    const totalParts = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
      const start = (partNumber - 1) * CHUNK_SIZE;
      const chunk = file.slice(start, Math.min(file.size, start + CHUNK_SIZE));
      const partResp = await fetch(
        `${API}/upload${base}/part?key=${encodeURIComponent(session.key)}&uploadId=${encodeURIComponent(session.uploadId)}&partNumber=${partNumber}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream', 'X-API-Token': token },
          body: chunk,
        },
      );
      const partData = await partResp.json();
      if (!partResp.ok || !partData.success || !partData.part?.etag) {
        throw new Error(partData.error || `Upload part ${partNumber} failed with status ${partResp.status}`);
      }
      parts.push({ partNumber: Number(partData.part.partNumber), etag: String(partData.part.etag) });
      opts.onProgress?.(Math.round((partNumber / totalParts) * 100));
    }

    const completeResp = await fetch(`${API}/upload${base}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Token': token },
      body: JSON.stringify({
        key: session.key,
        uploadId: session.uploadId,
        parts,
        name: session.name,
        size: session.size,
        contentType: session.contentType,
      }),
    });
    const completeData = await completeResp.json();
    if (!completeResp.ok || !completeData.success) {
      throw new Error(completeData.error || `Upload complete failed with status ${completeResp.status}`);
    }
    return { ok: true, name: completeData.name || file.name, key: session.key };
  } catch (err: any) {
    // Leaving a multipart upload dangling costs storage, so always try to abort.
    if (session?.uploadId && session?.key) {
      try {
        await fetch(`${API}/upload${base}/abort`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Token': token },
          body: JSON.stringify({ key: session.key, uploadId: session.uploadId }),
        });
      } catch { /* ignore abort cleanup errors */ }
    }
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function uploadRecordingFile(file: File, opts: Options = {}): Promise<UploadResult> {
  const stored = readStoredUser();
  if (!stored?.emailVerificationToken) return { ok: false, error: 'Not signed in' };
  if (!canManage(stored.role)) {
    return { ok: false, error: 'Only Admin or Superadmin users can upload to R2.' };
  }
  const base = stored.role === 'Superadmin' ? '' : '/direct';
  return runMultipart(file, stored.emailVerificationToken, base, opts);
}
