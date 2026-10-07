import { useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, uploadFiles, type FileItem } from '../api';
import { useAuth } from '../auth';
import { Icon, fileIcon } from './Icon';
import { useConfirm, useToast } from './ui';
import { bytes, shortDate } from '../format';

export function Dropzone({
  clientId,
  projectId,
  gated,
  onUploaded,
  compact,
  disabledReason,
}: {
  clientId: number | null;
  projectId?: number | null;
  gated?: boolean;
  onUploaded: (files: FileItem[]) => void;
  compact?: boolean;
  disabledReason?: string;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  const send = async (list: FileList | null) => {
    if (!list?.length) return;
    if (disabledReason) return toast(disabledReason, 'error');
    const form = new FormData();
    if (clientId) form.append('client_id', String(clientId));
    if (projectId) form.append('project_id', String(projectId));
    if (gated) form.append('requires_subscription', 'true');
    for (const f of Array.from(list)) form.append('files', f);
    setProgress(0);
    try {
      const out = (await uploadFiles(form, setProgress)) as FileItem[];
      onUploaded(out);
      toast(`Uploaded ${out.length} file${out.length === 1 ? '' : 's'}`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setProgress(null);
      if (input.current) input.current.value = '';
    }
  };

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    send(e.dataTransfer.files);
  };

  return (
    <div
      className={`dropzone ${compact ? 'compact' : ''} ${over ? 'over' : ''} ${disabledReason ? 'disabled' : ''}`}
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      onClick={() => input.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
    >
      <input ref={input} type="file" multiple hidden onChange={(e) => send(e.target.files)} />
      {progress != null ? (
        <div className="upload-progress">
          <span className="mono">uploading {progress}%</span>
          <div className="progress">
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : (
        <>
          <Icon name="upload" size={compact ? 16 : 20} />
          <span>
            <b>Drop files</b> or click to upload
          </span>
          {disabledReason && !compact && <span className="muted sm">{disabledReason}</span>}
        </>
      )}
    </div>
  );
}

export function FileTile({ file, onChange, onRemove, showClient }: { file: FileItem; onChange?: (f: FileItem) => void; onRemove?: (id: number) => void; showClient?: boolean }) {
  const auth = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const canManage = auth.isStaff || file.uploaded_by === auth.user?.id;
  const isImage = file.mime.startsWith('image/');
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(file.name);

  const rename = async () => {
    setRenaming(false);
    if (!name.trim() || name === file.name) return setName(file.name);
    try {
      await api(`/files/${file.id}`, { method: 'PATCH', body: { name: name.trim() } });
      onChange?.({ ...file, name: name.trim() });
    } catch (e) {
      toast((e as Error).message, 'error');
      setName(file.name);
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: `Delete ${file.name}?`, body: 'This permanently removes the file.', confirm: 'Delete', danger: true }))) return;
    try {
      await api(`/files/${file.id}`, { method: 'DELETE' });
      onRemove?.(file.id);
      toast('File deleted');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const toggleGate = async () => {
    const next = !file.requires_subscription;
    try {
      await api(`/files/${file.id}`, { method: 'PATCH', body: { requires_subscription: next } });
      onChange?.({ ...file, requires_subscription: next ? 1 : 0 });
      toast(next ? 'Now requires an active subscription' : 'Subscription gate removed', 'info');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const gatedForClients = file.invoices.length > 0 || !!file.requires_subscription;
  const pendingInvoice = file.invoices.find((i) => i.status === 'open');

  return (
    <div className={`file-tile ${file.locked ? 'locked' : ''}`}>
      <div className="file-thumb">
        {isImage && !file.locked ? (
          <img src={`/api/files/${file.id}/download?inline=1`} alt="" loading="lazy" />
        ) : (
          <Icon name={file.locked ? 'lock' : fileIcon(file.mime)} size={26} strokeWidth={1.5} />
        )}
        {auth.isStaff && gatedForClients && (
          <span className="gate-pill mono" title={file.invoices.length ? `Clients unlock via ${file.invoices.map((i) => i.number).join(', ')}` : 'Clients need an active subscription'}>
            <Icon name="lock" size={11} />
            {file.invoices.length ? file.invoices.map((i) => i.number).join(', ') : 'sub'}
          </span>
        )}
      </div>
      <div className="file-info">
        {renaming ? (
          <input autoFocus className="inline-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={rename} onKeyDown={(e) => e.key === 'Enter' && rename()} />
        ) : (
          <strong className="truncate" title={file.name}>
            {file.name}
          </strong>
        )}
        <span className="muted sm mono truncate">
          {bytes(file.size)} · {shortDate(file.created_at)}
          {showClient ? ` · ${file.client_name}` : ''}
          {file.project_title ? ` · ${file.project_title}` : ''}
        </span>
        {file.locked && (
          <span className="lock-reason sm">
            {file.reason}
            {pendingInvoice && (
              <>
                {' '}
                <Link to={`/billing?invoice=${pendingInvoice.id}`} className="link">
                  Pay now →
                </Link>
              </>
            )}
          </span>
        )}
      </div>
      <div className="file-actions">
        {file.locked ? (
          <span className="icon-btn disabled" title={file.reason ?? 'Locked'}>
            <Icon name="lock" />
          </span>
        ) : (
          <a className="icon-btn" href={`/api/files/${file.id}/download`} title="Download" download>
            <Icon name="download" />
          </a>
        )}
        {canManage && (
          <button className="icon-btn" title="Rename" onClick={() => setRenaming(true)}>
            <Icon name="edit" />
          </button>
        )}
        {auth.isStaff && file.uploader_role !== 'client' && (
          <button className={`icon-btn ${file.requires_subscription ? 'on' : ''}`} title={file.requires_subscription ? 'Remove subscription requirement' : 'Require an active subscription'} onClick={toggleGate}>
            <Icon name="repeat" />
          </button>
        )}
        {canManage && (
          <button className="icon-btn danger" title="Delete" onClick={remove}>
            <Icon name="trash" />
          </button>
        )}
      </div>
    </div>
  );
}
