import { useEffect, useState, type FormEvent } from 'react';
import { api, type FileItem, type Priority, type ProjectCard, type Status } from '../api';
import { useAuth } from '../auth';
import { Avatar, Drawer, Segmented, Skeleton, useConfirm, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { Dropzone, FileTile } from '../components/FileBits';
import { STATUS_LABEL, ago } from '../format';
import { tone } from '../theme';

interface Detail {
  id: number;
  client_id: number;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  due_date: string | null;
  created_at: string;
  client: { id: number; name: string; color: string | null };
  tasks: { id: number; title: string; done: number }[];
  comments: { id: number; user_id: number | null; body: string; created_at: string; author_name: string | null; author_role: string | null }[];
  files: FileItem[];
}

export function ProjectDrawer({ id, onClose, onChange }: { id: number | null; onClose: () => void; onChange: (id: number, patch: Partial<ProjectCard> | null) => void }) {
  const [lastId, setLastId] = useState(id);
  useEffect(() => {
    if (id) setLastId(id);
  }, [id]);
  return (
    <Drawer open={!!id} onClose={onClose} width={620}>
      {lastId && <DrawerBody key={lastId} id={lastId} onClose={onClose} onChange={onChange} />}
    </Drawer>
  );
}

function DrawerBody({ id, onClose, onChange }: { id: number; onClose: () => void; onChange: (id: number, patch: Partial<ProjectCard> | null) => void }) {
  const auth = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [p, setP] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newTask, setNewTask] = useState('');
  const [comment, setComment] = useState('');

  useEffect(() => {
    api<Detail>(`/projects/${id}`)
      .then(setP)
      .catch((e) => setError(e.message));
  }, [id]);

  const save = async (patch: Partial<Detail>) => {
    if (!p) return;
    const prev = p;
    setP({ ...p, ...patch });
    try {
      await api(`/projects/${id}`, { method: 'PATCH', body: patch });
      onChange(id, patch as Partial<ProjectCard>);
    } catch (e) {
      setP(prev);
      toast((e as Error).message, 'error');
    }
  };

  const syncTaskCounts = (tasks: Detail['tasks']) => onChange(id, { task_count: tasks.length, task_done: tasks.filter((t) => t.done).length });

  const addTask = async (e: FormEvent) => {
    e.preventDefault();
    if (!p || !newTask.trim()) return;
    try {
      const t = await api<Detail['tasks'][number]>(`/projects/${id}/tasks`, { body: { title: newTask } });
      const tasks = [...p.tasks, t];
      setP({ ...p, tasks });
      syncTaskCounts(tasks);
      setNewTask('');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const toggleTask = async (tid: number, done: boolean) => {
    if (!p) return;
    const tasks = p.tasks.map((t) => (t.id === tid ? { ...t, done: done ? 1 : 0 } : t));
    setP({ ...p, tasks });
    syncTaskCounts(tasks);
    await api(`/tasks/${tid}`, { method: 'PATCH', body: { done } }).catch((e) => toast(e.message, 'error'));
  };

  const removeTask = async (tid: number) => {
    if (!p) return;
    const tasks = p.tasks.filter((t) => t.id !== tid);
    setP({ ...p, tasks });
    syncTaskCounts(tasks);
    await api(`/tasks/${tid}`, { method: 'DELETE' }).catch((e) => toast(e.message, 'error'));
  };

  const postComment = async (e: FormEvent) => {
    e.preventDefault();
    if (!p || !comment.trim()) return;
    try {
      const c = await api<Detail['comments'][number]>(`/projects/${id}/comments`, { body: { body: comment } });
      setP({ ...p, comments: [...p.comments, c] });
      onChange(id, { comment_count: p.comments.length + 1 });
      setComment('');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: 'Delete this request?', body: 'Tasks and comments are deleted. Files stay in the client’s library.', confirm: 'Delete', danger: true }))) return;
    try {
      await api(`/projects/${id}`, { method: 'DELETE' });
      onChange(id, null);
      onClose();
      toast('Request deleted');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  if (error) {
    return (
      <div className="drawer-body">
        <p className="form-error">{error}</p>
      </div>
    );
  }
  if (!p) {
    return (
      <div className="drawer-body stack">
        <Skeleton h={28} w="70%" />
        <Skeleton h={18} w="40%" />
        <Skeleton h={120} />
      </div>
    );
  }

  const done = p.tasks.filter((t) => t.done).length;

  return (
    <>
      <header className="drawer-head">
        <span className="client-chip" style={{ ['--tone' as string]: tone(p.client.color) }}>
          {p.client.name}
        </span>
        <span className="mono muted sm">#{p.id} · opened {ago(p.created_at)}</span>
        <span className="grow" />
        {auth.isStaff && (
          <button className="icon-btn danger" onClick={remove} title="Delete request">
            <Icon name="trash" />
          </button>
        )}
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="x" />
        </button>
      </header>
      <div className="drawer-body">
        <input className="title-input" defaultValue={p.title} onBlur={(e) => e.target.value.trim() && e.target.value !== p.title && save({ title: e.target.value.trim() })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />

        <div className="props">
          <span className="prop-label">Status</span>
          <select value={p.status} onChange={(e) => save({ status: e.target.value as Status })}>
            {(['backlog', 'queued', 'in_progress', 'review', 'done'] as Status[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <span className="prop-label">Priority</span>
          <Segmented value={p.priority} onChange={(v) => save({ priority: v })} options={(['low', 'medium', 'high', 'urgent'] as Priority[]).map((x) => ({ value: x, label: x }))} />
          <span className="prop-label">Due</span>
          <input type="date" value={p.due_date ?? ''} onChange={(e) => save({ due_date: e.target.value || null })} />
        </div>

        <section className="section">
          <h4 className="section-title">Details</h4>
          <textarea className="desc" rows={5} defaultValue={p.description} placeholder="Add details, links, references…" onBlur={(e) => e.target.value !== p.description && save({ description: e.target.value })} />
        </section>

        <section className="section">
          <h4 className="section-title">
            Checklist <span className="mono muted">{p.tasks.length ? `${done}/${p.tasks.length}` : ''}</span>
          </h4>
          {p.tasks.length > 0 && (
            <div className="progress thin">
              <span style={{ width: `${(done / p.tasks.length) * 100}%` }} />
            </div>
          )}
          <ul className="tasks">
            {p.tasks.map((t) => (
              <li key={t.id} className={t.done ? 'done' : ''}>
                <label className="task-check">
                  <input type="checkbox" checked={!!t.done} onChange={(e) => toggleTask(t.id, e.target.checked)} />
                  <span className="box">
                    <Icon name="check" size={12} strokeWidth={3} />
                  </span>
                  <span className="task-title">{t.title}</span>
                </label>
                <button className="icon-btn xs" onClick={() => removeTask(t.id)} aria-label="Remove task">
                  <Icon name="x" size={13} />
                </button>
              </li>
            ))}
          </ul>
          <form onSubmit={addTask} className="add-task">
            <Icon name="plus" size={14} />
            <input value={newTask} onChange={(e) => setNewTask(e.target.value)} placeholder="Add a task and press Enter" />
          </form>
        </section>

        <section className="section">
          <h4 className="section-title">
            Files <span className="mono muted">{p.files.length || ''}</span>
          </h4>
          <div className="file-list">
            {p.files.map((f) => (
              <FileTile key={f.id} file={f} onChange={(nf) => setP({ ...p, files: p.files.map((x) => (x.id === nf.id ? nf : x)) })} onRemove={(fid) => (setP({ ...p, files: p.files.filter((x) => x.id !== fid) }), onChange(id, { file_count: p.files.length - 1 }))} />
            ))}
          </div>
          <Dropzone
            compact
            clientId={p.client_id}
            projectId={p.id}
            onUploaded={(fs) => {
              setP({ ...p, files: [...fs, ...p.files] });
              onChange(id, { file_count: p.files.length + fs.length });
            }}
          />
        </section>

        <section className="section">
          <h4 className="section-title">Conversation</h4>
          <ul className="comments">
            {p.comments.length === 0 && <li className="muted sm">No messages yet. Start the conversation below.</li>}
            {p.comments.map((c) => (
              <li key={c.id} className={c.author_role === 'client' ? 'from-client' : ''}>
                <Avatar name={c.author_name ?? '?'} color={c.author_role === 'client' ? p.client.color : 'accent'} size={26} />
                <div className="bubble">
                  <div className="bubble-head">
                    <strong>{c.author_name ?? 'Removed user'}</strong>
                    <span className="mono muted sm">{ago(c.created_at)}</span>
                  </div>
                  <p>{c.body}</p>
                </div>
              </li>
            ))}
          </ul>
          <form onSubmit={postComment} className="comment-form">
            <textarea
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Write a message…  (⌘↵ to send)"
              onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && postComment(e)}
            />
            <button className="btn primary" disabled={!comment.trim()}>
              <Icon name="send" size={14} />
              Send
            </button>
          </form>
        </section>
      </div>
    </>
  );
}
