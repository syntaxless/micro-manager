import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api, useApi, type ClientRow, type Priority, type ProjectCard, type Status } from '../api';
import { useAuth } from '../auth';
import { Badge, Field, Modal, Segmented, Skeleton, Spinner, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { PRIORITY_TONE, STATUS_LABEL, STATUS_TONE, dueState, shortDate } from '../format';
import { tone } from '../theme';
import { ProjectDrawer } from './ProjectDrawer';

const STATUSES: Status[] = ['backlog', 'queued', 'in_progress', 'review', 'done'];
type Columns = Record<Status, number[]>;
const colId = (s: Status) => `col:${s}`;

function buildColumns(cards: ProjectCard[]): Columns {
  const cols = Object.fromEntries(STATUSES.map((s) => [s, [] as number[]])) as Columns;
  for (const c of [...cards].sort((a, b) => a.position - b.position || a.id - b.id)) cols[c.status]?.push(c.id);
  return cols;
}

export function Board() {
  const auth = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const { data: projects, setData: setProjects, loading, reload } = useApi<ProjectCard[]>('/projects');
  const { data: clients } = useApi<ClientRow[]>(auth.isStaff ? '/clients' : null);
  const [clientFilter, setClientFilter] = useState<number | null>(params.get('client') ? Number(params.get('client')) : null);
  const [q, setQ] = useState('');
  const [prio, setPrio] = useState<Priority | 'all'>('all');
  const [hideDone, setHideDone] = useState(false);
  const [columns, setColumns] = useState<Columns>(() => buildColumns([]));
  const [activeId, setActiveId] = useState<number | null>(null);
  const snapshot = useRef<Columns | null>(null);
  const openId = params.get('open') ? Number(params.get('open')) : null;
  const newOpen = params.get('new') === '1';

  const byId = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p])), [projects]);

  const visible = useMemo(() => {
    const terms = q.toLowerCase().trim();
    return (projects ?? []).filter(
      (p) =>
        (!clientFilter || p.client_id === clientFilter) &&
        (prio === 'all' || p.priority === prio) &&
        (!terms || `${p.title} ${p.client_name}`.toLowerCase().includes(terms)),
    );
  }, [projects, clientFilter, q, prio]);

  // Rebuild columns from server data whenever the filter or data changes (but not mid-drag).
  useEffect(() => {
    if (activeId == null) setColumns(buildColumns(visible));
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findCol = (id: UniqueIdentifier, cols = columns): Status | null => {
    if (typeof id === 'string' && id.startsWith('col:')) return id.slice(4) as Status;
    return (STATUSES.find((s) => cols[s].includes(Number(id))) as Status) ?? null;
  };

  const onDragStart = (e: DragStartEvent) => {
    setActiveId(Number(e.active.id));
    snapshot.current = columns;
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const from = findCol(active.id);
    const to = findCol(over.id);
    if (!from || !to || from === to) return;
    setColumns((cols) => {
      const id = Number(active.id);
      const target = cols[to];
      const overIndex = typeof over.id === 'string' ? target.length : target.indexOf(Number(over.id));
      const below =
        over.rect && active.rect.current.translated ? active.rect.current.translated.top > over.rect.top + over.rect.height / 2 : false;
      const index = overIndex < 0 ? target.length : overIndex + (below ? 1 : 0);
      return {
        ...cols,
        [from]: cols[from].filter((x) => x !== id),
        [to]: [...target.slice(0, index), id, ...target.slice(index)],
      };
    });
  };

  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    const id = Number(active.id);
    setActiveId(null);
    const before = snapshot.current;
    snapshot.current = null;
    if (!over || !before) {
      if (before) setColumns(before);
      return;
    }
    const col = findCol(active.id);
    if (!col) return;
    let next = columns;
    const overCol = findCol(over.id);
    if (overCol === col && typeof over.id === 'number') {
      const oldIndex = columns[col].indexOf(id);
      const newIndex = columns[col].indexOf(over.id);
      if (oldIndex !== newIndex) next = { ...columns, [col]: arrayMove(columns[col], oldIndex, newIndex) };
    }
    setColumns(next);
    const list = next[col];
    const idx = list.indexOf(id);
    const prevCol = STATUSES.find((s) => before[s].includes(id));
    if (prevCol === col && before[col].indexOf(id) === idx) return;

    const card = byId.get(id)!;
    const aboveId = list[idx - 1] ?? null;
    const belowId = list[idx + 1] ?? null;
    // Mirror the server's fractional position so the card doesn't jump while the request is in flight.
    const a = aboveId != null ? byId.get(aboveId)?.position : undefined;
    const b = belowId != null ? byId.get(belowId)?.position : undefined;
    const guess = a != null && b != null ? (a + b) / 2 : a != null ? a + 1000 : b != null ? b - 1000 : card.position;
    setProjects((ps) => ps?.map((p) => (p.id === id ? { ...p, status: col, position: guess } : p)) ?? ps);
    try {
      const res = await api<{ position: number }>(`/projects/${id}/move`, {
        body: { status: col, before_id: aboveId, after_id: belowId },
      });
      setProjects((ps) => ps?.map((p) => (p.id === id ? { ...p, status: col, position: res.position } : p)) ?? ps);
      if (prevCol !== col) toast(`Moved to ${STATUS_LABEL[col]}`, 'info');
    } catch (e) {
      setColumns(before);
      setProjects((ps) => ps?.map((p) => (p.id === id ? card : p)) ?? ps);
      toast((e as Error).message, 'error');
      reload();
    }
  };

  const setOpen = (id: number | null) => {
    const p = new URLSearchParams(params);
    if (id) p.set('open', String(id));
    else p.delete('open');
    setParams(p, { replace: true });
  };

  const patchCard = (id: number, patch: Partial<ProjectCard> | null) => {
    setProjects((ps) => (patch === null ? ps?.filter((p) => p.id !== id) ?? ps : ps?.map((p) => (p.id === id ? { ...p, ...patch } : p)) ?? ps));
  };

  const activeCard = activeId != null ? byId.get(activeId) : null;
  const shownStatuses = hideDone ? STATUSES.filter((s) => s !== 'done') : STATUSES;

  return (
    <div className="board-page">
      <header className="page-head">
        <div>
          <p className="eyebrow mono">~/board</p>
          <h1>Requests</h1>
          <p className="muted">{auth.isStaff ? 'Drag cards to plan the work.' : 'Drag cards to set what we should work on first. Top of a column is highest priority.'}</p>
        </div>
        <button className="btn primary" onClick={() => setParams({ new: '1' })}>
          <Icon name="plus" /> New request
        </button>
      </header>

      <div className="toolbar">
        <div className="search">
          <Icon name="search" size={14} />
          <input placeholder="Filter requests…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {auth.isStaff && (
          <select value={clientFilter ?? ''} onChange={(e) => setClientFilter(e.target.value ? Number(e.target.value) : null)}>
            <option value="">All clients</option>
            {clients?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <Segmented
          value={prio}
          onChange={setPrio}
          options={[
            { value: 'all', label: 'All' },
            { value: 'urgent', label: 'Urgent' },
            { value: 'high', label: 'High' },
            { value: 'medium', label: 'Med' },
            { value: 'low', label: 'Low' },
          ]}
        />
        <label className="check">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
          <span>Hide done</span>
        </label>
      </div>

      {loading && !projects ? (
        <div className="board">
          {STATUSES.map((s) => (
            <div className="column" key={s}>
              <div className="column-head">
                <Skeleton w={90} />
              </div>
              <div className="column-body">
                <Skeleton h={70} />
                <Skeleton h={70} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => (snapshot.current && setColumns(snapshot.current), setActiveId(null))}>
          <div className="board">
            {shownStatuses.map((s) => (
              <Column key={s} status={s} ids={columns[s]} byId={byId} showClient={auth.isStaff && !clientFilter} onOpen={setOpen} activeId={activeId} />
            ))}
          </div>
          <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' }}>
            {activeCard ? <CardView card={activeCard} showClient={auth.isStaff && !clientFilter} lifted /> : null}
          </DragOverlay>
        </DndContext>
      )}

      <NewRequest
        open={newOpen}
        onClose={() => setParams({}, { replace: true })}
        clients={clients ?? []}
        defaultClient={clientFilter}
        onCreated={(p) => {
          const client = clients?.find((c) => c.id === p.client_id);
          setProjects((ps) => [
            ...(ps ?? []),
            {
              ...p,
              client_name: client?.name ?? auth.client?.name ?? '',
              client_color: client?.color ?? null,
              task_count: 0,
              task_done: 0,
              comment_count: 0,
              file_count: 0,
            },
          ]);
        }}
      />
      <ProjectDrawer id={openId} onClose={() => setOpen(null)} onChange={patchCard} />
    </div>
  );
}

function Column({ status, ids, byId, showClient, onOpen, activeId }: { status: Status; ids: number[]; byId: Map<number, ProjectCard>; showClient: boolean; onOpen: (id: number) => void; activeId: number | null }) {
  const { setNodeRef, isOver } = useDroppable({ id: colId(status) });
  const t = STATUS_TONE[status];
  return (
    <section className={`column ${isOver ? 'over' : ''}`} style={{ ['--tone' as string]: t === 'muted' ? 'var(--muted)' : `var(--${t})` }}>
      <header className="column-head">
        <span className="column-dot" />
        <h3>{STATUS_LABEL[status]}</h3>
        <span className="count mono">{ids.length}</span>
      </header>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="column-body" ref={setNodeRef}>
          {ids.map((id, i) => {
            const card = byId.get(id);
            return card ? <SortableCard key={id} card={card} showClient={showClient} onOpen={onOpen} rank={status === 'queued' ? i + 1 : undefined} dimmed={activeId === id} /> : null;
          })}
          {ids.length === 0 && <div className="column-empty mono">drop here</div>}
        </div>
      </SortableContext>
    </section>
  );
}

function SortableCard({ card, showClient, onOpen, rank, dimmed }: { card: ProjectCard; showClient: boolean; onOpen: (id: number) => void; rank?: number; dimmed: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: card.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`card-slot ${dimmed ? 'placeholder' : ''}`}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(card.id)}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (e.key === 'Enter' && !e.defaultPrevented) onOpen(card.id);
      }}
    >
      <CardView card={card} showClient={showClient} rank={rank} />
    </div>
  );
}

function CardView({ card, showClient, lifted, rank }: { card: ProjectCard; showClient: boolean; lifted?: boolean; rank?: number }) {
  const due = dueState(card.due_date);
  const pct = card.task_count ? card.task_done / card.task_count : 0;
  return (
    <article className={`kcard ${lifted ? 'lifted' : ''} prio-${card.priority}`}>
      {rank && <span className="rank mono" title="Priority order">#{rank}</span>}
      {showClient && (
        <div className="kcard-top">
          <span className="client-chip" style={{ ['--tone' as string]: tone(card.client_color) }}>
            {card.client_name}
          </span>
        </div>
      )}
      <h4>{card.title}</h4>
      <div className="kcard-meta">
        <Badge tone={PRIORITY_TONE[card.priority]} dot>
          {card.priority}
        </Badge>
        {card.due_date && (
          <span className={`meta mono due ${due ?? ''}`}>
            <Icon name="calendar" size={12} />
            {shortDate(card.due_date)}
          </span>
        )}
        <span className="grow" />
        {card.comment_count > 0 && (
          <span className="meta mono">
            <Icon name="message" size={12} />
            {card.comment_count}
          </span>
        )}
        {card.file_count > 0 && (
          <span className="meta mono">
            <Icon name="file" size={12} />
            {card.file_count}
          </span>
        )}
      </div>
      {card.task_count > 0 && (
        <div className="progress" title={`${card.task_done}/${card.task_count} tasks`}>
          <span style={{ width: `${pct * 100}%` }} />
          <em className="mono">
            {card.task_done}/{card.task_count}
          </em>
        </div>
      )}
    </article>
  );
}

function NewRequest({ open, onClose, clients, defaultClient, onCreated }: { open: boolean; onClose: () => void; clients: ClientRow[]; defaultClient: number | null; onCreated: (p: ProjectCard) => void }) {
  const auth = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ title: '', description: '', priority: 'medium' as Priority, due_date: '', client_id: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setF({ title: '', description: '', priority: 'medium', due_date: '', client_id: defaultClient ? String(defaultClient) : '' });
  }, [open, defaultClient]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const p = await api<ProjectCard>('/projects', {
        body: {
          title: f.title,
          description: f.description,
          priority: f.priority,
          due_date: f.due_date || null,
          client_id: auth.isStaff ? Number(f.client_id) : undefined,
        },
      });
      onCreated(p);
      toast('Request created');
      onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New request"
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" form="new-request" disabled={busy}>
            {busy ? <Spinner /> : 'Create request'}
          </button>
        </>
      }
    >
      <form id="new-request" className="stack" onSubmit={submit}>
        {auth.isStaff && (
          <Field label="Client">
            <select required value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value })}>
              <option value="">Choose a client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Title">
          <input required autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Homepage hero illustration" />
        </Field>
        <Field label="Details">
          <textarea rows={4} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="What do you need? Links, references, sizes…" />
        </Field>
        <div className="row-2">
          <Field label="Priority">
            <Segmented
              value={f.priority}
              onChange={(v) => setF({ ...f, priority: v })}
              options={(['low', 'medium', 'high', 'urgent'] as Priority[]).map((p) => ({ value: p, label: p }))}
            />
          </Field>
          <Field label="Due date">
            <input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
          </Field>
        </div>
      </form>
    </Modal>
  );
}
