import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type CalendarEvent } from '../api';
import { Icon, Modal, formatDateBR, useToast, weekdayLong } from '../ui';

type View = 'mes' | 'lista' | 'semana';
type Source = 'local' | 'google';

const DOW = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function CalendarPage() {
  const toast = useToast();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [view, setView] = useState<View>('mes');
  const [source, setSource] = useState<Source>('local');
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<CalendarEvent | null>(null);
  const [googleConnected, setGoogleConnected] = useState(false);

  const range = useMemo(() => {
    if (view === 'semana') {
      const base = new Date(cursor);
      const start = new Date(base);
      start.setDate(base.getDate() - base.getDay());
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return { from: iso(start), to: iso(end) };
    }
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    if (view === 'lista') {
      // a lista mostra da data atual em diante, dentro do mês visível
      return { from: iso(start), to: iso(end) };
    }
    const gridStart = new Date(start);
    gridStart.setDate(start.getDate() - start.getDay());
    const gridEnd = new Date(end);
    gridEnd.setDate(end.getDate() + (6 - end.getDay()));
    return { from: iso(gridStart), to: iso(gridEnd) };
  }, [cursor, view]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ items: CalendarEvent[] }>(
        `/google/events?from=${range.from}&to=${range.to}&source=${source}`
      );
      setEvents(res.items);
    } catch (e) {
      toast.err((e as Error).message);
      setEvents([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, source]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .get<{ connected: boolean }>('/google/status')
      .then((s) => setGoogleConnected(s.connected))
      .catch(() => setGoogleConnected(false));
  }, []);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const key = (e.date || e.start || '').slice(0, 10);
      if (!key) continue;
      const list = map.get(key) || [];
      list.push(e);
      map.set(key, list);
    }
    for (const list of map.values()) list.sort((a, b) => (a.start > b.start ? 1 : -1));
    return map;
  }, [events]);

  function shift(delta: number) {
    if (view === 'semana') {
      const d = new Date(cursor);
      d.setDate(d.getDate() + delta * 7);
      setCursor(d);
    } else {
      setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1));
    }
  }

  const headerLabel =
    view === 'semana'
      ? `${formatDateBR(range.from)} – ${formatDateBR(range.to)}`
      : cursor.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Agenda</h1>
          <p className="page-sub">
            {source === 'local'
              ? 'Eventos confirmados e realizados do sistema'
              : 'Eventos lidos diretamente do Google Agenda'}
          </p>
        </div>
      </div>

      <div className="cal-head">
        <button className="btn btn-ghost btn-sm" onClick={() => shift(-1)} aria-label="Anterior">
          <Icon.Chevron className="flip" />
        </button>
        <div className="cal-month">{headerLabel}</div>
        <button className="btn btn-ghost btn-sm" onClick={() => shift(1)} aria-label="Próximo">
          <Icon.Chevron />
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}
        >
          Hoje
        </button>

        <div style={{ flex: 1 }} />

        <div className="seg">
          {(['mes', 'semana', 'lista'] as View[]).map((v) => (
            <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>
              {v === 'mes' ? 'Mês' : v === 'semana' ? 'Semana' : 'Lista'}
            </button>
          ))}
        </div>

        {googleConnected && (
          <div className="seg">
            <button className={source === 'local' ? 'active' : ''} onClick={() => setSource('local')}>
              Sistema
            </button>
            <button className={source === 'google' ? 'active' : ''} onClick={() => setSource('google')}>
              Google
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="loading-page">
          <div className="spinner dark" />
        </div>
      ) : view === 'mes' ? (
        <MonthGrid cursor={cursor} from={range.from} byDay={byDay} onPick={setDetail} />
      ) : view === 'semana' ? (
        <WeekList from={range.from} byDay={byDay} onPick={setDetail} />
      ) : (
        <AgendaList events={events} onPick={setDetail} />
      )}

      {detail && <EventModal event={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function MonthGrid({
  cursor,
  from,
  byDay,
  onPick,
}: {
  cursor: Date;
  from: string;
  byDay: Map<string, CalendarEvent[]>;
  onPick: (e: CalendarEvent) => void;
}) {
  const today = iso(new Date());
  const days: string[] = [];
  const start = new Date(`${from}T12:00:00`);
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(iso(d));
    if (i >= 34 && d.getMonth() !== cursor.getMonth() && d.getDay() === 6) break;
  }

  return (
    <div className="cal-grid">
      {DOW.map((d) => (
        <div className="cal-dow" key={d}>
          {d}
        </div>
      ))}
      {days.map((day) => {
        const list = byDay.get(day) || [];
        const outside = Number(day.slice(5, 7)) - 1 !== cursor.getMonth();
        return (
          <div key={day} className={`cal-day ${outside ? 'out' : ''} ${day === today ? 'today' : ''}`}>
            <span className="cal-daynum">{Number(day.slice(8, 10))}</span>
            {list.slice(0, 4).map((e) => (
              <button
                key={e.id}
                className={`cal-ev ${e.status || ''}`}
                onClick={() => onPick(e)}
                title={`${e.startTime || ''} ${e.summary}`}
              >
                {e.startTime ? `${e.startTime} ` : ''}
                {e.summary}
              </button>
            ))}
            {list.length > 4 && <span className="cell-soft" style={{ fontSize: '0.66rem' }}>+{list.length - 4}</span>}
          </div>
        );
      })}
    </div>
  );
}

function WeekList({
  from,
  byDay,
  onPick,
}: {
  from: string;
  byDay: Map<string, CalendarEvent[]>;
  onPick: (e: CalendarEvent) => void;
}) {
  const days: string[] = [];
  const start = new Date(`${from}T12:00:00`);
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(iso(d));
  }
  return (
    <div className="agenda-list">
      {days.map((day) => {
        const list = byDay.get(day) || [];
        return (
          <div key={day}>
            <div className="agenda-day">
              {weekdayLong(day)} · {formatDateBR(day)}
            </div>
            {list.length === 0 ? (
              <div className="cell-soft" style={{ padding: '6px 2px' }}>
                Sem eventos
              </div>
            ) : (
              list.map((e) => <AgendaItem key={e.id} e={e} onPick={onPick} />)
            )}
          </div>
        );
      })}
    </div>
  );
}

function AgendaList({ events, onPick }: { events: CalendarEvent[]; onPick: (e: CalendarEvent) => void }) {
  if (!events.length) {
    return (
      <div className="card empty">
        <div className="empty-icon">📅</div>
        <p>Nenhum evento no período selecionado.</p>
      </div>
    );
  }
  const groups = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const key = (e.date || e.start || '').slice(0, 10);
    const list = groups.get(key) || [];
    list.push(e);
    groups.set(key, list);
  }
  return (
    <div className="agenda-list">
      {[...groups.entries()].map(([day, list]) => (
        <div key={day}>
          <div className="agenda-day">
            {weekdayLong(day)} · {formatDateBR(day)}
          </div>
          {list.map((e) => (
            <AgendaItem key={e.id} e={e} onPick={onPick} />
          ))}
        </div>
      ))}
    </div>
  );
}

function AgendaItem({ e, onPick }: { e: CalendarEvent; onPick: (e: CalendarEvent) => void }) {
  return (
    <button className="agenda-item" onClick={() => onPick(e)}>
      <span className="agenda-time">{e.startTime || e.start.slice(11, 16)}</span>
      <span style={{ flex: 1 }}>
        <span className="cell-strong" style={{ display: 'block' }}>
          {e.summary}
        </span>
        {e.location && <span className="cell-soft">{e.location}</span>}
      </span>
    </button>
  );
}

function EventModal({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  const whats = event.whatsapp
    ? `https://wa.me/${event.whatsapp.length <= 11 ? '55' : ''}${event.whatsapp}`
    : '';
  return (
    <Modal
      title={event.summary}
      onClose={onClose}
      footer={
        <>
          {whats && (
            <a className="btn btn-whats" href={whats} target="_blank" rel="noreferrer">
              <Icon.Whats />
              WhatsApp
            </a>
          )}
          {event.htmlLink && (
            <a className="btn btn-ghost" href={event.htmlLink} target="_blank" rel="noreferrer">
              Abrir no Google
            </a>
          )}
        </>
      }
    >
      <div className="detail-grid">
        <div className="detail-item">
          <div className="k">Início</div>
          <div className="v">
            {formatDateBR(event.start.slice(0, 10))} às {event.startTime || event.start.slice(11, 16)}
          </div>
        </div>
        <div className="detail-item">
          <div className="k">Término</div>
          <div className="v">{event.endTime || event.end.slice(11, 16)}</div>
        </div>
        {event.arrivalTime && (
          <div className="detail-item">
            <div className="k">Chegada da equipe</div>
            <div className="v">{event.arrivalTime}</div>
          </div>
        )}
        {event.audience && (
          <div className="detail-item">
            <div className="k">Público</div>
            <div className="v">{event.audience}</div>
          </div>
        )}
      </div>
      {event.location && (
        <>
          <div className="section-title">Local</div>
          <p style={{ margin: 0 }}>{event.location}</p>
          <a
            className="btn btn-ghost btn-sm"
            style={{ marginTop: 10 }}
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`}
            target="_blank"
            rel="noreferrer"
          >
            <Icon.Pin />
            Ver no mapa
          </a>
        </>
      )}
      {event.description && (
        <>
          <div className="section-title">Pauta</div>
          <p style={{ whiteSpace: 'pre-wrap', margin: 0, lineHeight: 1.6 }}>{event.description}</p>
        </>
      )}
    </Modal>
  );
}
