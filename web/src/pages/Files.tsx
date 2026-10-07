import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi, type ClientRow, type FileItem } from '../api';
import { useAuth } from '../auth';
import { Empty, Segmented, Skeleton } from '../components/ui';
import { Icon } from '../components/Icon';
import { Dropzone, FileTile } from '../components/FileBits';
import { bytes } from '../format';

export function Files() {
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const clientId = params.get('client') ? Number(params.get('client')) : null;
  const { data: files, setData: setFiles, loading } = useApi<FileItem[]>(`/files${clientId ? `?client_id=${clientId}` : ''}`);
  const { data: clients } = useApi<ClientRow[]>(auth.isStaff ? '/clients' : null);
  const [q, setQ] = useState('');
  const [show, setShow] = useState<'all' | 'available' | 'locked'>('all');
  const [view, setView] = useState<'grid' | 'list'>(() => (localStorage.getItem('mm-file-view') as 'grid' | 'list') || 'grid');
  const [gated, setGated] = useState(false);

  const shown = useMemo(() => {
    const t = q.toLowerCase().trim();
    return (files ?? []).filter(
      (f) =>
        (!t || `${f.name} ${f.project_title ?? ''} ${f.client_name}`.toLowerCase().includes(t)) &&
        (show === 'all' || (show === 'locked' ? f.locked || (auth.isStaff && (f.invoices.length > 0 || !!f.requires_subscription)) : !f.locked)),
    );
  }, [files, q, show, auth.isStaff]);

  const total = (files ?? []).reduce((a, f) => a + f.size, 0);
  const lockedCount = (files ?? []).filter((f) => f.locked).length;
  const setView2 = (v: 'grid' | 'list') => {
    setView(v);
    try {
      localStorage.setItem('mm-file-view', v);
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow mono">~/files</p>
          <h1>Files</h1>
          <p className="muted">
            {files ? `${files.length} file${files.length === 1 ? '' : 's'} · ${bytes(total)}` : ' '}
            {!auth.isStaff && lockedCount > 0 && ` · ${lockedCount} waiting on payment`}
          </p>
        </div>
      </header>

      <div className="toolbar">
        <div className="search">
          <Icon name="search" size={14} />
          <input placeholder="Search files…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {auth.isStaff && (
          <select value={clientId ?? ''} onChange={(e) => setParams(e.target.value ? { client: e.target.value } : {})}>
            <option value="">All clients</option>
            {clients?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <Segmented
          value={show}
          onChange={setShow}
          options={[
            { value: 'all', label: 'All' },
            { value: 'available', label: 'Available' },
            { value: 'locked', label: auth.isStaff ? 'Gated' : 'Locked' },
          ]}
        />
        <span className="grow" />
        <Segmented
          value={view}
          onChange={setView2}
          options={[
            { value: 'grid', label: <Icon name="grid" size={14} /> },
            { value: 'list', label: <Icon name="list" size={14} /> },
          ]}
        />
      </div>

      <div className="upload-row">
        <Dropzone
          clientId={auth.isStaff ? clientId : auth.user!.client_id}
          gated={gated}
          disabledReason={auth.isStaff && !clientId ? 'Pick a client above to upload files for them' : undefined}
          onUploaded={(fs) => setFiles((cur) => [...fs, ...(cur ?? [])])}
        />
        {auth.isStaff && (
          <label className="check">
            <input type="checkbox" checked={gated} onChange={(e) => setGated(e.target.checked)} />
            <span>Require an active subscription to download</span>
          </label>
        )}
      </div>

      {loading && !files ? (
        <div className={`files ${view}`}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} h={view === 'grid' ? 180 : 56} />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <Empty icon="folder" title={files?.length ? 'No files match' : 'No files yet'}>
          {files?.length ? 'Try a different filter.' : auth.isStaff ? 'Upload deliverables for a client, then attach them to an invoice.' : 'Files your team shares with you will appear here.'}
        </Empty>
      ) : (
        <div className={`files ${view}`}>
          {shown.map((f, i) => (
            <div className="stagger" style={{ animationDelay: `${Math.min(i, 12) * 22}ms` }} key={f.id}>
              <FileTile
                file={f}
                showClient={auth.isStaff && !clientId}
                onChange={(nf) => setFiles((cur) => cur?.map((x) => (x.id === nf.id ? nf : x)) ?? cur)}
                onRemove={(id) => setFiles((cur) => cur?.filter((x) => x.id !== id) ?? cur)}
              />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
