import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, downloadFile, STATUS_LABELS, type AgendaRequest, type Status } from '../api';
import { Icon, addHours, formatDateBR, maskPhone, useToast } from '../ui';
import {
  EMPTY_FILTERS,
  EMPTY_OPTIONS,
  FiltersBar,
  buildQuery,
  type FilterOptions,
  type Filters,
} from './RequestsPage';

export default function ReportsPage() {
  const toast = useToast();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [items, setItems] = useState<AgendaRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState<FilterOptions>(EMPTY_OPTIONS);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ items: AgendaRequest[] }>(`/admin/requests${buildQuery(filters)}`);
      setItems(res.items);
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    api
      .get<FilterOptions>('/admin/options')
      .then(setOptions)
      .catch(() => undefined);
  }, []);

  const summary = useMemo(() => {
    const byStatus: Record<string, number> = {};
    const byCity: Record<string, number> = {};
    const byDistrict: Record<string, number> = {};
    const byMonth: Record<string, number> = {};
    let hours = 0;
    for (const r of items) {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      const city = r.city || 'Não informada';
      byCity[city] = (byCity[city] || 0) + 1;
      const district = r.district || 'Não informado';
      byDistrict[district] = (byDistrict[district] || 0) + 1;
      const month = r.event_date.slice(0, 7);
      byMonth[month] = (byMonth[month] || 0) + 1;
      if (r.status === 'confirmado' || r.status === 'realizado') hours += r.duration_hours;
    }
    const topCities = Object.entries(byCity)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    const topDistricts = Object.entries(byDistrict)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    const months = Object.entries(byMonth).sort((a, b) => (a[0] > b[0] ? 1 : -1));
    return { byStatus, topCities, topDistricts, months, hours };
  }, [items]);

  async function exportXlsx() {
    try {
      await downloadFile(`/admin/export.xlsx${buildQuery(filters)}`, 'relatorio-agenda.xlsx');
      toast.ok('Planilha gerada com os filtros aplicados.');
    } catch (e) {
      toast.err((e as Error).message);
    }
  }

  const maxMonth = Math.max(1, ...summary.months.map(([, n]) => n));
  const maxCity = Math.max(1, ...summary.topCities.map(([, n]) => n));
  const maxDistrict = Math.max(1, ...summary.topDistricts.map(([, n]) => n));

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Relatórios</h1>
          <p className="page-sub">Consolidado das solicitações conforme os filtros aplicados</p>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary btn-sm" onClick={() => void exportXlsx()}>
          <Icon.Download />
          Exportar Excel
        </button>
      </div>

      <FiltersBar filters={filters} setFilters={setFilters} options={options} />

      {loading ? (
        <div className="loading-page">
          <div className="spinner dark" />
        </div>
      ) : (
        <>
          <div className="stats">
            <div className="stat">
              <b>{items.length}</b>
              <span>Solicitações</span>
            </div>
            {(Object.keys(STATUS_LABELS) as Status[]).map((s) => (
              <div className={`stat ${s}`} key={s}>
                <b>{summary.byStatus[s] || 0}</b>
                <span>{STATUS_LABELS[s]}</span>
              </div>
            ))}
            <div className="stat confirmado">
              <b>{summary.hours}h</b>
              <span>Horas de agenda</span>
            </div>
          </div>

          <div className="grid-2" style={{ alignItems: 'start' }}>
            <div className="card">
              <div className="section-title">Agendas por mês</div>
              {summary.months.length === 0 ? (
                <p className="cell-soft">Sem dados no período.</p>
              ) : (
                <div className="stack" style={{ gap: 10 }}>
                  {summary.months.map(([m, n]) => (
                    <Bar key={m} label={monthLabel(m)} value={n} max={maxMonth} />
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <div className="section-title">Principais cidades</div>
              {summary.topCities.length === 0 ? (
                <p className="cell-soft">Sem dados no período.</p>
              ) : (
                <div className="stack" style={{ gap: 10 }}>
                  {summary.topCities.map(([c, n]) => (
                    <Bar key={c} label={c} value={n} max={maxCity} />
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <div className="section-title">Principais bairros</div>
              {summary.topDistricts.length === 0 ? (
                <p className="cell-soft">Sem dados no período.</p>
              ) : (
                <div className="stack" style={{ gap: 10 }}>
                  {summary.topDistricts.map(([d, n]) => (
                    <Bar key={d} label={d} value={n} max={maxDistrict} />
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
            <div className="table-wrap" style={{ border: 'none', boxShadow: 'none', borderRadius: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>Protocolo</th>
                    <th>Data</th>
                    <th>Horário</th>
                    <th>Solicitante</th>
                    <th>WhatsApp</th>
                    <th>Bairro</th>
                    <th>Cidade</th>
                    <th>Público</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={r.id}>
                      <td className="cell-soft">{r.protocol}</td>
                      <td>{formatDateBR(r.event_date)}</td>
                      <td className="cell-soft">
                        {r.start_time}–{addHours(r.start_time, r.duration_hours)}
                      </td>
                      <td className="cell-strong">{r.requester_name}</td>
                      <td className="cell-soft">{maskPhone(r.whatsapp)}</td>
                      <td className="cell-soft">{r.district}</td>
                      <td className="cell-soft">{r.city}</td>
                      <td className="cell-soft">{r.audience}</td>
                      <td>{STATUS_LABELS[r.status]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.84rem', marginBottom: 4 }}>
        <span style={{ textTransform: 'capitalize' }}>{label}</span>
        <strong>{value}</strong>
      </div>
      <div style={{ background: 'var(--blue-50)', borderRadius: 999, height: 9, overflow: 'hidden' }}>
        <div
          style={{
            width: `${Math.round((value / max) * 100)}%`,
            height: '100%',
            background: 'linear-gradient(90deg, var(--navy-400), var(--navy))',
            borderRadius: 999,
          }}
        />
      </div>
    </div>
  );
}

function monthLabel(m: string): string {
  const [y, mm] = m.split('-').map(Number);
  return new Date(y, mm - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}
