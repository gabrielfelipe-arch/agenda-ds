import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, type PublicEvent } from '../api';
import { Icon, formatDateBR, maskCep, maskPhone, onlyDigits, weekdayLong, useToast } from '../ui';

interface FormData {
  name: string;
  whatsapp: string;
  cep: string;
  district: string;
  city: string;
}

const EMPTY: FormData = { name: '', whatsapp: '', cep: '', district: '', city: '' };

type Errors = Partial<Record<keyof FormData, string>>;

export default function EventPublicPage() {
  const { slug = '' } = useParams();
  const toast = useToast();
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [data, setData] = useState<FormData>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [sending, setSending] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);
  const [done, setDone] = useState<'ok' | 'already' | null>(null);
  // Honeypot anti-robô: humano não vê nem preenche este campo.
  const [website, setWebsite] = useState('');

  useEffect(() => {
    api
      .get<PublicEvent>(`/public/events/${encodeURIComponent(slug)}`)
      .then(setEvent)
      .catch(() => setNotFound(true));
  }, [slug]);

  const set = <K extends keyof FormData>(k: K, v: string) => {
    setData((p) => ({ ...p, [k]: v }));
    setErrors((p) => ({ ...p, [k]: undefined }));
  };

  async function lookupCep(raw: string) {
    const cep = onlyDigits(raw);
    if (cep.length !== 8) return;
    setCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const json = (await res.json()) as { erro?: boolean | string; bairro?: string; localidade?: string };
      if (json.erro) {
        setErrors((p) => ({ ...p, cep: 'CEP não encontrado. Preencha o bairro manualmente.' }));
        return;
      }
      setData((p) => ({
        ...p,
        district: (json.bairro || p.district).toUpperCase(),
        city: (json.localidade || p.city).toUpperCase(),
      }));
      setErrors((p) => ({ ...p, cep: undefined, district: undefined }));
    } catch {
      setErrors((p) => ({ ...p, cep: 'Não foi possível consultar o CEP. Preencha o bairro manualmente.' }));
    } finally {
      setCepLoading(false);
    }
  }

  function validate(): boolean {
    const e: Errors = {};
    if (data.name.trim().length < 3) e.name = 'Informe o nome completo';
    const phone = onlyDigits(data.whatsapp);
    if (phone.length < 10 || phone.length > 11) e.whatsapp = 'Informe o WhatsApp com DDD';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate()) return;
    setSending(true);
    try {
      const res = await api.post<{ ok: boolean; already?: boolean }>(
        `/public/events/${encodeURIComponent(slug)}/attendees`,
        {
          name: data.name,
          whatsapp: onlyDigits(data.whatsapp),
          cep: onlyDigits(data.cep),
          district: data.district,
          city: data.city,
          website,
        }
      );
      setDone(res.already ? 'already' : 'ok');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      toast.err((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  if (notFound) {
    return (
      <div className="form-shell">
        <div className="form-container">
          <div className="card card-head" style={{ textAlign: 'center' }}>
            <div className="empty-icon">🔎</div>
            <h1 className="form-title" style={{ fontSize: '1.3rem' }}>
              Evento não encontrado
            </h1>
            <p className="form-description" style={{ textAlign: 'center' }}>
              O link pode estar incompleto ou o evento já foi realizado. Confira a mensagem mais recente no
              WhatsApp para ver os próximos eventos.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="loading-page">
        <div className="spinner dark" />
        <span>Carregando evento…</span>
      </div>
    );
  }

  const dateLine = `${formatDateBR(event.event_date)} (${weekdayLong(event.event_date)})`;
  const timeLine = event.end_time ? `${event.start_time} às ${event.end_time}` : event.start_time;

  return (
    <div className="form-shell">
      <div className="form-container">
        <div className={`card card-head ${event.image_url ? 'has-banner' : ''}`}>
          {event.image_url && (
            <img
              className="form-banner"
              src={event.image_url}
              alt=""
              onError={(e) => (e.currentTarget.style.display = 'none')}
            />
          )}
          <h1 className="form-title">{event.title}</h1>
          <div className="stack" style={{ gap: 6, marginTop: 10 }}>
            <div className="req-line">
              <Icon.Calendar /> {dateLine}
            </div>
            <div className="req-line">
              <Icon.Clock /> {timeLine}
            </div>
            <div className="req-line">
              <Icon.Pin /> {event.location}
            </div>
          </div>
          {event.description && <p className="form-description">{event.description}</p>}
        </div>

        {done ? (
          <div className="card success-box">
            <div className="success-icon">
              <Icon.Check />
            </div>
            <h2 className="form-title" style={{ fontSize: '1.2rem' }}>
              {done === 'already' ? 'Você já está na lista!' : 'Presença confirmada!'}
            </h2>
            <p className="form-description" style={{ textAlign: 'center' }}>
              {done === 'already'
                ? 'Este WhatsApp já estava inscrito neste evento. Nos vemos lá!'
                : 'Sua inscrição foi registrada. Nos vemos lá!'}
            </p>
          </div>
        ) : !event.collect_open ? (
          <div className="card">
            <div className="alert alert-warn">As inscrições deste evento já foram encerradas.</div>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <div className="card">
              <div className="section-title">Confirme sua presença</div>

              <div className="field">
                <label className="label" htmlFor="nome">
                  Nome completo<span className="req">*</span>
                </label>
                <input
                  id="nome"
                  className={`input ${errors.name ? 'error' : ''}`}
                  value={data.name}
                  onChange={(e) => set('name', e.target.value.toUpperCase())}
                  placeholder="DIGITE SEU NOME COMPLETO"
                  autoComplete="name"
                  maxLength={150}
                />
                {errors.name && <span className="error-text">{errors.name}</span>}
              </div>

              <div className="field">
                <label className="label" htmlFor="whats">
                  WhatsApp<span className="req">*</span>
                </label>
                <input
                  id="whats"
                  className={`input ${errors.whatsapp ? 'error' : ''}`}
                  value={data.whatsapp}
                  onChange={(e) => set('whatsapp', maskPhone(e.target.value))}
                  placeholder="(21) 99999-9999"
                  inputMode="tel"
                  autoComplete="tel-national"
                />
                {errors.whatsapp && <span className="error-text">{errors.whatsapp}</span>}
              </div>

              <div className="grid-2">
                <div className="field">
                  <label className="label" htmlFor="cep">
                    CEP
                  </label>
                  <span className="hint">Preencha para identificarmos o bairro.</span>
                  <input
                    id="cep"
                    className={`input ${errors.cep ? 'error' : ''}`}
                    value={data.cep}
                    onChange={(e) => {
                      const masked = maskCep(e.target.value);
                      set('cep', masked);
                      void lookupCep(masked);
                    }}
                    placeholder="00000-000"
                    inputMode="numeric"
                    autoComplete="postal-code"
                  />
                  {cepLoading && <span className="hint">Buscando CEP…</span>}
                  {errors.cep && <span className="error-text">{errors.cep}</span>}
                </div>
                <div className="field">
                  <label className="label" htmlFor="bairro">
                    Bairro
                  </label>
                  <input
                    id="bairro"
                    className={`input ${errors.district ? 'error' : ''}`}
                    value={data.district}
                    onChange={(e) => set('district', e.target.value.toUpperCase())}
                    placeholder="SEU BAIRRO"
                    maxLength={120}
                  />
                  {errors.district && <span className="error-text">{errors.district}</span>}
                </div>
              </div>

              {/* Honeypot: fora da tela; robôs preenchem, pessoas não. */}
              <input
                type="text"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                name="website"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
              />

              <div className="form-actions">
                <button className="btn btn-primary btn-block" disabled={sending}>
                  {sending ? <div className="spinner" /> : <Icon.Check />}
                  Confirmar presença
                </button>
              </div>
            </div>
          </form>
        )}

        <footer className="form-footer">
          <p className="footer-brand">Seu voto é + saúde para sua família</p>
        </footer>
      </div>
    </div>
  );
}
