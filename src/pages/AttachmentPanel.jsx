import { useState, useEffect, useRef } from 'react';
import { Paperclip, Upload, Trash2, FileText, Image, File, X, ExternalLink, Loader, AlertCircle } from 'lucide-react';
import { attachments } from '../store';
import { useAuth } from '../auth/AuthProvider';

function fileIcon(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['jpg','jpeg','png','gif','webp','svg'].includes(ext)) return <Image size={14}/>;
  if (ext === 'pdf') return <FileText size={14}/>;
  return <File size={14}/>;
}
function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function AttachmentPanel({ tx, verNum, onClose }) {
  const { orgId } = useAuth();
  const [files, setFiles]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [uploading, setUploading]     = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [dragOver, setDragOver]       = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const inputRef = useRef();

  async function reload() {
    setLoading(true);
    try { setFiles(await attachments.list(orgId, tx.id)); }
    catch { setFiles([]); }
    finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, [tx.id]);

  async function handleUpload(fileList) {
    if (!fileList?.length) return;
    setUploading(true);
    setUploadError('');
    try {
      await attachments.upload(orgId, tx.id, Array.from(fileList));
      await reload();
    } catch (e) {
      setUploadError(`Uppladdning misslyckades: ${e.message || 'okänt fel'}`);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleDelete(filename) {
    if (deleteConfirm === filename) {
      try {
        await attachments.delete(orgId, tx.id, filename);
        setDeleteConfirm(null);
        await reload();
      } catch { /* ignore */ }
    } else {
      setDeleteConfirm(filename);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    handleUpload(e.dataTransfer.files);
  }

  const verLabel = `VER${String(verNum).padStart(3, '0')}`;

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth:560 }}>
        <div className="modal-header">
          <div>
            <div className="modal-title" style={{ display:'flex', alignItems:'center', gap:8 }}>
              <Paperclip size={16} style={{ color:'var(--accent)' }}/>
              Bilagor – {verLabel}
            </div>
            <div style={{ fontSize:'0.78rem', color:'var(--ink-muted)', marginTop:3 }}>
              {tx.date} · {tx.description || '–'}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18}/></button>
        </div>

        {uploadError && (
          <div className="notice" style={{ background:'var(--red-soft)', borderColor:'#f5c6cb', color:'var(--red)', marginBottom:12, display:'flex', gap:8, alignItems:'flex-start' }}>
            <AlertCircle size={14} style={{ flexShrink:0, marginTop:2 }}/>
            <span style={{ fontSize:'0.82rem' }}>{uploadError}</span>
          </div>
        )}

        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => !uploading && inputRef.current?.click()}
          style={{
            border:`2px dashed ${dragOver ? 'var(--accent-2)' : 'var(--border)'}`,
            borderRadius:'var(--r-lg)',
            background: dragOver ? 'var(--accent-3)' : 'var(--paper)',
            padding:'24px 16px', textAlign:'center',
            cursor: uploading ? 'default' : 'pointer',
            transition:'all 0.15s', marginBottom:16,
          }}
        >
          <input ref={inputRef} type="file" multiple style={{ display:'none' }}
            onChange={e => handleUpload(e.target.files)} />
          {uploading ? (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8, color:'var(--accent)' }}>
              <Loader size={24} style={{ animation:'spin 1s linear infinite' }}/>
              <span style={{ fontSize:'0.85rem' }}>Laddar upp…</span>
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6, color:'var(--ink-muted)' }}>
              <Upload size={24} style={{ opacity:0.5 }}/>
              <span style={{ fontSize:'0.88rem', fontWeight:500 }}>Dra och släpp filer här, eller klicka för att välja</span>
              <span style={{ fontSize:'0.75rem' }}>PDF, bilder, Word, Excel – max 50 MB per fil</span>
            </div>
          )}
        </div>

        {loading ? (
          <div style={{ textAlign:'center', padding:'24px', color:'var(--ink-muted)' }}>
            <Loader size={20} style={{ animation:'spin 1s linear infinite' }}/>
          </div>
        ) : files.length === 0 ? (
          <div style={{ textAlign:'center', padding:'16px', color:'var(--ink-muted)', fontSize:'0.85rem' }}>
            Inga bilagor uppladdade ännu.
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:16 }}>
            {files.map(f => (
              <div key={f.name} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', borderRadius:'var(--r)', background:'var(--paper-2)', border:'1px solid var(--border)' }}>
                <span style={{ color:'var(--ink-soft)', flexShrink:0 }}>{fileIcon(f.name)}</span>
                <span style={{ flex:1, fontSize:'0.85rem', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.name}</span>
                <span style={{ fontSize:'0.72rem', color:'var(--ink-muted)', flexShrink:0 }}>{fmtSize(f.size)}</span>
                <a href={f.url} target="_blank" rel="noreferrer" title="Öppna"
                  style={{ color:'var(--accent)', flexShrink:0, display:'flex' }}>
                  <ExternalLink size={14}/>
                </a>
                <button onClick={() => handleDelete(f.name)}
                  title={deleteConfirm === f.name ? 'Klicka igen för att bekräfta' : 'Ta bort'}
                  style={{ background: deleteConfirm === f.name ? 'var(--red-soft)' : 'none', border:'none', cursor:'pointer', padding:'2px 4px', borderRadius:'var(--r)', color: deleteConfirm === f.name ? 'var(--red)' : 'var(--ink-muted)', flexShrink:0, display:'flex', transition:'all 0.15s' }}>
                  <Trash2 size={13}/>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
