'use client';

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';

type View = 'interno' | 'cliente';
type Stage = 'draft' | 'sent' | 'signed';
type DeliveryStatus = 'Entregado' | 'Pendiente' | 'En tránsito';

type OrderData = {
  id?: string;
  shareToken?: string;
  number: string;
  issueDate: string;
  requestedBy: string;
  payment: string;
  dueDate: string;
  buyer: string;
  product: string;
  description: string;
  unitPrice: string;
  totalQuantity: string;
  productNotes: string;
  generalNotes: string;
  clientName: string;
  clientEmail: string;
  status?: Stage;
  finalStatus: string;
  signatureName?: string | null;
  signatureDni?: string | null;
  signedAt?: string | null;
};

type Delivery = {
  id: number;
  deliveryNumber: number;
  date: string;
  quantity: number;
  shipment: string;
  fiscal: string;
  status: DeliveryStatus;
  notes: string;
  receivedByName?: string;
  receivedByDni?: string;
  receivedAt?: string | null;
};

type OrderSummary = {
  id: string;
  number: string;
  product: string;
  clientName: string;
  status: Stage;
  finalStatus: string;
  totalQuantity: number;
  updatedAt: string;
};

type ApiPayload = { order?: OrderData & { deliveries?: Delivery[] }; orders?: OrderSummary[]; shareUrl?: string; warning?: string; error?: string };

const initialOrder: OrderData = {
  number: '',
  issueDate: '',
  requestedBy: '',
  payment: '',
  dueDate: '',
  buyer: '',
  product: '',
  description: '',
  unitPrice: '',
  totalQuantity: '',
  productNotes: '',
  generalNotes: '',
  clientName: '',
  clientEmail: '',
  finalStatus: 'Pendiente de entrega',
};

const stages = [
  { label: 'Armar orden', step: '1' },
  { label: 'Enviar al cliente', step: '2' },
  { label: 'Cliente firma', step: '3' },
  { label: 'Registrar entregas', step: '4' },
];

function normalizeOrder(order: OrderData & { totalQuantity: string | number; deliveries?: Delivery[] }) {
  return { ...order, totalQuantity: String(order.totalQuantity), clientEmail: order.clientEmail || '' };
}

function formatDate(value: string) {
  if (!value) return '—';
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(parsed);
}

function formatUpdatedAt(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(parsed);
}

function formatCurrency(value: string) {
  const number = Number(String(value).replace(',', '.'));
  if (Number.isNaN(number)) return value || '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).format(number);
}

function formatRecipients(value: string) {
  return value.split(/[;,\s]+/).map((email) => email.trim()).filter(Boolean).join(', ');
}

function recipientList(value: string) {
  return [...new Set(value.split(/[;,\s]+/).map((email) => email.trim().toLowerCase()).filter(Boolean))];
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function stageIndex(stage: Stage) {
  return stage === 'signed' ? 3 : stage === 'sent' ? 2 : 0;
}

function automaticFinalStatus(stage: Stage, totalQuantity: number, deliveries: Delivery[]) {
  const deliveredQuantity = deliveries.filter((delivery) => delivery.status === 'Entregado').reduce((sum, delivery) => sum + delivery.quantity, 0);
  if (stage !== 'signed' || deliveredQuantity <= 0) return 'Pendiente de entrega';
  return totalQuantity > 0 && deliveredQuantity >= totalQuantity ? 'Entrega completa' : 'Entrega parcial';
}

function historyStatusLabel(order: OrderSummary) {
  if (order.status === 'draft') return 'Borrador';
  if (order.status === 'sent') return 'Esperando firma';
  return order.finalStatus;
}

function historyStatusClass(order: OrderSummary) {
  if (order.status === 'draft') return 'status-draft';
  if (order.status === 'sent') return 'status-sent';
  if (order.finalStatus === 'Entrega completa') return 'status-complete';
  if (order.finalStatus === 'Entrega parcial') return 'status-partial';
  return 'status-pending';
}

export default function OrderWorkspace({ initialMode, token }: { initialMode: View; token?: string }) {
  const [view, setView] = useState(initialMode);
  const [stage, setStage] = useState<Stage>('draft');
  const [order, setOrder] = useState(initialOrder);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [orderId, setOrderId] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [signatureName, setSignatureName] = useState('');
  const [signatureDni, setSignatureDni] = useState('');
  const [signatureAccepted, setSignatureAccepted] = useState(false);
  const [newDelivery, setNewDelivery] = useState({ date: '', quantity: '', shipment: '', fiscal: '', notes: '' });
  const [isAddingDelivery, setIsAddingDelivery] = useState(false);
  const [deliverySignatureId, setDeliverySignatureId] = useState<number | null>(null);
  const [deliverySignatureName, setDeliverySignatureName] = useState('');
  const [deliverySignatureDni, setDeliverySignatureDni] = useState('');
  const [recipientDraft, setRecipientDraft] = useState('');
  const [history, setHistory] = useState<OrderSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(initialMode === 'interno');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(initialMode === 'cliente');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const totalQuantity = Math.max(Number(order.totalQuantity) || 0, 0);
  const sentQuantity = useMemo(() => deliveries.reduce((sum, delivery) => sum + delivery.quantity, 0), [deliveries]);
  const receivedQuantity = useMemo(() => deliveries.filter((delivery) => delivery.status === 'Entregado').reduce((sum, delivery) => sum + delivery.quantity, 0), [deliveries]);
  const inTransitQuantity = Math.max(sentQuantity - receivedQuantity, 0);
  const pendingQuantity = Math.max(totalQuantity - sentQuantity, 0);
  const progress = totalQuantity ? Math.min(Math.round((receivedQuantity / totalQuantity) * 100), 100) : 0;
  const canEdit = view === 'interno' && stage === 'draft';
  const isSigned = stage === 'signed';
  const activeStage = stageIndex(stage);
  const currentFinalStatus = automaticFinalStatus(stage, totalQuantity, deliveries);

  function applyLoadedOrder(payload: ApiPayload) {
    if (!payload.order) return;
    const loaded = normalizeOrder(payload.order);
    setOrder(loaded);
    setOrderId(loaded.id ?? '');
    setDeliveries(payload.order.deliveries ?? []);
    setStage(loaded.status ?? 'draft');
    setShareUrl(payload.shareUrl || (loaded.shareToken ? `${window.location.origin}/orden/${loaded.shareToken}` : ''));
    setRecipientDraft('');
  }

  async function refreshHistory() {
    if (initialMode !== 'interno' || token) return;
    const response = await fetch('/api/orders?history=1', { cache: 'no-store' });
    const payload = await response.json() as ApiPayload;
    if (!response.ok) throw new Error(payload.error || 'No pudimos cargar el historial.');
    setHistory(payload.orders ?? []);
  }

  useEffect(() => {
    let cancelled = false;
    async function loadOrder() {
      const searchId = initialMode === 'interno' ? new URLSearchParams(window.location.search).get('id') : null;
      if (!token && !searchId) {
        setLoading(false);
        return;
      }
      try {
        const query = token ? `token=${encodeURIComponent(token)}` : `id=${encodeURIComponent(searchId ?? '')}`;
        const response = await fetch(`/api/orders?${query}`, { cache: 'no-store' });
        const payload = await response.json() as ApiPayload;
        if (!response.ok || !payload.order) throw new Error(payload.error || 'No encontramos esta orden.');
        if (cancelled) return;
        applyLoadedOrder(payload);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'No pudimos cargar la orden.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadOrder();
    return () => { cancelled = true; };
  }, [initialMode, token]);

  useEffect(() => {
    let cancelled = false;
    async function loadHistory() {
      if (initialMode !== 'interno' || token) return;
      try {
        setHistoryLoading(true);
        await refreshHistory();
      } catch {
        if (!cancelled) setHistory([]);
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    }
    loadHistory();
    return () => { cancelled = true; };
  }, [initialMode, token]);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(''), 3200);
  }

  function updateOrder(field: keyof OrderData, value: string) {
    setOrder((current) => ({ ...current, [field]: value }));
  }

  function addRecipient() {
    const candidate = recipientDraft.trim().replace(/[;,]+$/, '').toLowerCase();
    if (!candidate) return;
    if (!isValidEmail(candidate)) {
      showToast('Ingresá un correo electrónico válido.');
      return;
    }
    updateOrder('clientEmail', [...new Set([...recipientList(order.clientEmail), candidate])].join(', '));
    setRecipientDraft('');
  }

  function removeRecipient(email: string) {
    updateOrder('clientEmail', recipientList(order.clientEmail).filter((item) => item !== email).join(', '));
  }

  function handleRecipientKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
      event.preventDefault();
      addRecipient();
    }
  }

  function handleNewOrder() {
    if (stage === 'draft' && orderId && !window.confirm('La orden actual quedará guardada. ¿Querés comenzar una nueva orden?')) return;
    setView('interno');
    setStage('draft');
    setOrder(initialOrder);
    setDeliveries([]);
    setOrderId('');
    setShareUrl('');
    setSignatureName('');
    setSignatureDni('');
    setSignatureAccepted(false);
    setNewDelivery({ date: '', quantity: '', shipment: '', fiscal: '', notes: '' });
    setDeliverySignatureId(null);
    setDeliverySignatureName('');
    setDeliverySignatureDni('');
    setRecipientDraft('');
    setIsAddingDelivery(false);
    setError('');
    setToast('');
    window.history.replaceState({}, '', '/');
  }

  async function handleSelectHistory(id: string) {
    setBusy(`history-${id}`);
    try {
      const response = await fetch(`/api/orders?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
      const payload = await response.json() as ApiPayload;
      if (!response.ok || !payload.order) throw new Error(payload.error || 'No pudimos abrir la orden.');
      applyLoadedOrder(payload);
      setView('interno');
      setIsAddingDelivery(false);
      setSignatureName('');
      setSignatureDni('');
      setSignatureAccepted(false);
      setError('');
      window.history.replaceState({}, '', `/?id=${encodeURIComponent(id)}`);
    } catch (historyError) {
      showToast(historyError instanceof Error ? historyError.message : 'No pudimos abrir la orden.');
    } finally {
      setBusy('');
    }
  }

  async function saveOrder() {
    const response = await fetch(orderId ? `/api/orders/${orderId}` : '/api/orders', {
      method: orderId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...order, totalQuantity: Number(order.totalQuantity) || 0, finalStatus: order.finalStatus }),
    });
    const payload = await response.json() as ApiPayload;
    if (!response.ok || !payload.order) throw new Error(payload.error || 'No pudimos guardar la orden.');
    const saved = normalizeOrder(payload.order);
    setOrder(saved);
    setOrderId(saved.id ?? '');
    const url = saved.shareToken ? `${window.location.origin}/orden/${saved.shareToken}` : '';
    setShareUrl(url);
    if (!orderId && saved.id) window.history.replaceState({}, '', `/?id=${encodeURIComponent(saved.id)}`);
    try { await refreshHistory(); } catch { /* El guardado no debe fallar si el historial tarda en actualizarse. */ }
    return saved;
  }

  async function handleSaveDraft() {
    setBusy('save');
    try { await saveOrder(); showToast('Orden guardada online'); } catch (saveError) { showToast(saveError instanceof Error ? saveError.message : 'No pudimos guardar la orden.'); } finally { setBusy(''); }
  }

  async function handleSendOrder() {
    setBusy('send');
    try {
      const saved = await saveOrder();
      const response = await fetch(`/api/orders/${saved.id}/send`, { method: 'POST' });
      const payload = await response.json() as ApiPayload;
      if (!response.ok || !payload.order) throw new Error(payload.error || 'No pudimos enviar la orden.');
      const sent = normalizeOrder(payload.order);
      setOrder(sent);
      setStage('sent');
      setShareUrl(payload.shareUrl || (sent.shareToken ? `${window.location.origin}/orden/${sent.shareToken}` : ''));
      try { await refreshHistory(); } catch { /* El envío ya se completó aunque el historial tarde en actualizarse. */ }
      showToast(`Orden enviada a ${formatRecipients(sent.clientEmail) || 'los destinatarios indicados'}`);
    } catch (sendError) { showToast(sendError instanceof Error ? sendError.message : 'No pudimos enviar la orden.'); } finally { setBusy(''); }
  }

  async function handleSignOrder() {
    if (!orderId || !signatureName.trim() || !signatureDni.trim() || !signatureAccepted) return;
    setBusy('sign');
    try {
      const response = await fetch(`/api/orders/${orderId}/sign`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signatureName, signatureDni }) });
      const payload = await response.json() as ApiPayload;
      if (!response.ok || !payload.order) throw new Error(payload.error || 'No pudimos registrar la firma.');
      const signed = normalizeOrder(payload.order);
      setOrder(signed);
      setStage('signed');
      setSignatureName('');
      setSignatureDni('');
      setSignatureAccepted(false);
      if (payload.warning) showToast(payload.warning); else showToast('Orden firmada y confirmada.');
    } catch (signError) { showToast(signError instanceof Error ? signError.message : 'No pudimos registrar la firma.'); } finally { setBusy(''); }
  }

  async function handleAddDelivery() {
    if (!orderId) return;
    const quantity = Number(newDelivery.quantity);
    if (!newDelivery.date || !quantity || quantity < 1 || quantity > pendingQuantity) return;
    setBusy('delivery');
    try {
      const response = await fetch(`/api/orders/${orderId}/deliveries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...newDelivery, quantity }) });
      const payload = await response.json() as ApiPayload;
      if (!response.ok || !payload.order) throw new Error(payload.error || 'No pudimos registrar la entrega.');
      const updated = normalizeOrder(payload.order);
      setOrder(updated);
      setDeliveries(payload.order.deliveries ?? []);
      setNewDelivery({ date: '', quantity: '', shipment: '', fiscal: '', notes: '' });
      setIsAddingDelivery(false);
      try { await refreshHistory(); } catch { /* La entrega ya se guardó aunque el historial tarde en actualizarse. */ }
      if (payload.warning) showToast(`Entrega registrada. ${payload.warning}`); else showToast('Entrega parcial registrada y aviso enviado.');
    } catch (deliveryError) { showToast(deliveryError instanceof Error ? deliveryError.message : 'No pudimos registrar la entrega.'); } finally { setBusy(''); }
  }

  async function handleSignDelivery() {
    if (!orderId || deliverySignatureId === null || !deliverySignatureName.trim() || !deliverySignatureDni.trim()) return;
    setBusy(`delivery-sign-${deliverySignatureId}`);
    try {
      const response = await fetch(`/api/orders/${orderId}/deliveries/${deliverySignatureId}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signatureName: deliverySignatureName, signatureDni: deliverySignatureDni }),
      });
      const payload = await response.json() as ApiPayload;
      if (!response.ok || !payload.order) throw new Error(payload.error || 'No pudimos confirmar la entrega.');
      const updated = normalizeOrder(payload.order);
      setOrder(updated);
      setDeliveries(payload.order.deliveries ?? []);
      setDeliverySignatureId(null);
      setDeliverySignatureName('');
      setDeliverySignatureDni('');
      if (payload.warning) showToast(`Recepción confirmada. ${payload.warning}`); else showToast('Recepción confirmada y aviso enviado.');
    } catch (deliverySignError) {
      showToast(deliverySignError instanceof Error ? deliverySignError.message : 'No pudimos confirmar la entrega.');
    } finally {
      setBusy('');
    }
  }

  async function handleCopyLink() {
    if (!shareUrl) return;
    await navigator.clipboard?.writeText(shareUrl);
    showToast('Enlace copiado');
  }

  if (loading) return <div className="loading-page"><img src="/logo-ful-mar.png" alt="Ful-Mar" className="loading-logo" /><p>Cargando orden...</p></div>;
  if (error) return <div className="error-page"><img src="/logo-ful-mar.png" alt="Ful-Mar" className="loading-logo" /><h1>No pudimos abrir esta orden</h1><p>{error}</p></div>;

  return (
    <div className="app-shell">
      <header className="topbar"><div className="brand"><img src="/logo-ful-mar.png" alt="Ful-Mar" className="brand-logo" /><div><strong>Órdenes de compra</strong><small>{view === 'interno' ? 'Gestión interna' : 'Revisión del cliente'}</small></div></div><div className="topbar-right">{view === 'interno' && <button type="button" className="button button-light topbar-button" onClick={handleNewOrder}>Nueva orden</button>}</div></header>
      <main className="page">
        <section className="page-heading"><div><p className="eyebrow">{view === 'interno' ? 'Orden de compra' : 'Revisión del cliente'}</p><h1>{view === 'interno' ? 'Armar orden de compra' : 'Orden de compra recibida'}</h1><p className="heading-copy">{view === 'interno' ? 'Completá la planilla, enviala y esperá la firma del cliente.' : isSigned ? 'Consultá la orden y confirmá cada entrega cuando la recibas.' : 'Revisá la información y firmá la orden para confirmar su recepción.'}</p></div></section>
        <section className={`hero-banner ${view === 'cliente' ? 'hero-banner-client' : ''}`}><div className="hero-logo-wrap"><img src="/logo-ful-mar.png" alt="Ful-Mar" /></div><div className="hero-copy"><span>{view === 'interno' ? 'FUL-MAR · Gestión de órdenes' : 'FUL-MAR · Orden recibida'}</span><h2>{view === 'interno' ? 'Gestión de órdenes de compra' : isSigned ? 'Confirmación de entregas parciales' : 'Revisá y firmá la orden de compra'}</h2><p>{view === 'interno' ? 'Orden, seguimiento y entregas.' : isSigned ? 'Confirmá la recepción de cada despacho.' : 'La firma requiere nombre completo y DNI.'}</p></div><div className="hero-mark">{view === 'interno' ? 'OC' : '✓'}</div></section>
        <div className={`workspace-layout ${view === 'cliente' ? 'client-layout' : ''}`}>
          {view === 'interno' && <aside className="history-panel">
            <div className="history-heading"><div><p className="eyebrow">Registro</p><h2>Historial de órdenes</h2></div><button type="button" className="history-new-button" onClick={handleNewOrder}>＋ Nueva</button></div>
            {historyLoading ? <div className="history-empty">Cargando órdenes...</div> : history.length === 0 ? <div className="history-empty"><strong>Aún no hay órdenes</strong><span>Las órdenes guardadas aparecerán acá.</span></div> : <div className="history-list">{history.map((item) => <button type="button" className={`history-item ${item.id === orderId ? 'is-selected' : ''}`} key={item.id} onClick={() => handleSelectHistory(item.id)} disabled={busy.startsWith('history-')}><span className="history-item-top"><strong>{item.number || 'Sin número'}</strong><span className={`history-status ${historyStatusClass(item)}`}>{historyStatusLabel(item)}</span></span><span className="history-product">{item.product || 'Producto sin especificar'}</span><span className="history-meta">{item.clientName || 'Cliente sin nombre'} · {formatUpdatedAt(item.updatedAt)}</span></button>)}</div>}
          </aside>}
          <div className="workspace-content">
        {view === 'interno' && <section className="flow-card"><div className="flow-intro"><span className="flow-label">Estado de la orden</span><span className={`top-status ${stage === 'signed' ? 'is-signed' : stage === 'sent' ? 'is-sent' : ''}`}>{stage === 'signed' ? 'Firmada' : stage === 'sent' ? 'Enviada al cliente' : 'Borrador'}</span></div><div className="flow-steps">{stages.map((item, index) => <div className={`flow-step ${index < activeStage ? 'completed' : ''} ${index === activeStage ? 'current' : ''}`} key={item.label}><span className="flow-number">{index < activeStage ? '✓' : item.step}</span><div><small>Paso {item.step}</small><strong>{item.label}</strong></div>{index < stages.length - 1 && <i className={index < activeStage ? 'completed' : ''} />}</div>)}</div></section>}
        {view === 'interno' && stage === 'sent' && <div className="notice notice-sent"><span className="notice-icon">↗</span><div><strong>La orden fue enviada a {formatRecipients(order.clientEmail) || 'los destinatarios indicados'}</strong><p>El cliente puede abrirla desde el enlace y firmarla online.</p></div></div>}
        {view === 'interno' && isSigned && <div className="notice notice-signed"><span className="notice-icon">✓</span><div><strong>Firma recibida de {order.signatureName || order.clientName}</strong><p>La orden quedó guardada online y ya permite registrar entregas parciales.</p></div></div>}
        {view === 'cliente' && <div className="client-banner"><div className="client-badge">✓</div><div><strong>{isSigned ? 'Orden confirmada' : 'Orden enviada para revisión'}</strong><span>{isSigned ? 'Podés confirmar cada entrega recibida.' : 'La firma requiere nombre completo y DNI.'}</span></div><span className="client-readonly">Solo lectura</span></div>}
        {view === 'interno' && stage !== 'draft' && shareUrl && <div className="share-panel"><div><span>Enlace para el cliente</span><code>{shareUrl}</code></div><button type="button" onClick={handleCopyLink}>Copiar enlace</button></div>}

        <section className={`order-sheet ${view === 'cliente' ? 'client-sheet' : ''}`}>
          <div className="sheet-header"><div><span className="sheet-kicker">Orden de Compra Autotaxímetro ZTX-PRO</span><h2>{order.number || 'Sin número de orden'}</h2></div><span className={`sheet-status ${isSigned ? 'status-complete' : stage === 'sent' ? 'status-sent' : 'status-draft'}`}>{isSigned ? 'Firmada' : stage === 'sent' ? 'Esperando firma' : 'Borrador'}</span></div>
          <div className="sheet-section"><div className="section-heading"><div><span className="section-number">01</span><div><h3>Datos generales de la Orden de Compra</h3><p>{view === 'interno' ? 'Completá la información principal.' : 'Información principal de la orden.'}</p></div></div></div><div className="fields-grid"><label className="field"><span>N.º de Orden de Compra</span>{canEdit ? <input value={order.number} onChange={(event) => updateOrder('number', event.target.value)} /> : <strong>{order.number || '—'}</strong>}</label><label className="field"><span>Fecha de emisión</span>{canEdit ? <input type="date" value={order.issueDate} onChange={(event) => updateOrder('issueDate', event.target.value)} /> : <strong>{formatDate(order.issueDate)}</strong>}</label><label className="field"><span>Solicita</span>{canEdit ? <input value={order.requestedBy} onChange={(event) => updateOrder('requestedBy', event.target.value)} /> : <strong>{order.requestedBy || '—'}</strong>}</label><label className="field"><span>Condición de pago</span>{canEdit ? <input value={order.payment} onChange={(event) => updateOrder('payment', event.target.value)} /> : <strong>{order.payment || '—'}</strong>}</label><label className="field"><span>Fecha de entrega pactada</span>{canEdit ? <input type="date" value={order.dueDate} onChange={(event) => updateOrder('dueDate', event.target.value)} /> : <strong>{formatDate(order.dueDate)}</strong>}</label><label className="field"><span>Responsable de la compra</span>{canEdit ? <input value={order.buyer} onChange={(event) => updateOrder('buyer', event.target.value)} /> : <strong>{order.buyer || '—'}</strong>}</label></div></div>
          <div className="sheet-section"><div className="section-heading"><div><span className="section-number">02</span><div><h3>Datos del destinatario</h3><p>Destinatarios de la orden.</p></div></div></div><div className="recipient-row"><label className="field"><span>Nombre del cliente</span>{canEdit ? <input value={order.clientName} onChange={(event) => updateOrder('clientName', event.target.value)} /> : <strong>{order.clientName || '—'}</strong>}</label><div className="field recipient-email-field"><span>Correos electrónicos</span>{canEdit ? <div className="recipient-editor"><div className="recipient-tags">{recipientList(order.clientEmail).map((email) => <span className="recipient-tag" key={email}>{email}<button type="button" aria-label={`Quitar ${email}`} onClick={() => removeRecipient(email)}>×</button></span>)}</div><div className="recipient-entry"><input type="text" value={recipientDraft} onChange={(event) => setRecipientDraft(event.target.value)} onKeyDown={handleRecipientKeyDown} placeholder="Agregar correo electrónico" /><button type="button" className="recipient-add-button" aria-label="Agregar correo electrónico" onClick={addRecipient}>→</button></div><small className="field-help">Escribí un correo y presioná la flecha para agregarlo.</small></div> : <strong>{formatRecipients(order.clientEmail) || '—'}</strong>}</div></div></div>
          <div className="sheet-section"><div className="section-heading"><div><span className="section-number">03</span><div><h3>Detalle de productos/servicios</h3><p>Podés registrar la cantidad total del pedido.</p></div></div></div><div className="table-scroll"><table className="purchase-table"><thead><tr><th>Producto</th><th>Descripción</th><th>Precio (R$)</th><th>Cantidad total</th><th>Observaciones</th></tr></thead><tbody><tr><td>{canEdit ? <input value={order.product} onChange={(event) => updateOrder('product', event.target.value)} /> : <strong>{order.product || '—'}</strong>}</td><td>{canEdit ? <input value={order.description} onChange={(event) => updateOrder('description', event.target.value)} /> : <span>{order.description || '—'}</span>}</td><td>{canEdit ? <input value={order.unitPrice} onChange={(event) => updateOrder('unitPrice', event.target.value)} placeholder="0,00" /> : <span>{formatCurrency(order.unitPrice)}</span>}</td><td>{canEdit ? <input type="number" min="1" value={order.totalQuantity} onChange={(event) => updateOrder('totalQuantity', event.target.value)} /> : <strong>{totalQuantity.toLocaleString('es-AR')} u.</strong>}</td><td>{canEdit ? <textarea className="product-notes-input" value={order.productNotes} onChange={(event) => updateOrder('productNotes', event.target.value)} rows={3} /> : <span className="product-notes-readonly">{order.productNotes || '—'}</span>}</td></tr></tbody></table></div>{canEdit && <div className="sheet-total"><span>Total estimado (R$)</span><strong>{formatCurrency((Number(order.unitPrice || 0) * Number(order.totalQuantity || 0)).toFixed(2))}</strong></div>}</div>
          {view === 'cliente' && <div className="signature-section"><div className="signature-heading"><div><span className="section-number">04</span><div><h3>Firma del cliente</h3><p>La firma confirma que la orden fue recibida y revisada.</p></div></div><span className={`signature-state ${isSigned ? 'signed' : ''}`}>{isSigned ? '✓ Firmada' : 'Pendiente'}</span></div>{isSigned ? <div className="signed-confirmation"><span>✓</span><div><strong>Orden firmada correctamente</strong><p>La firma quedó registrada y la orden está disponible para continuar con el seguimiento.</p><small>Firmante: {order.signatureName || '—'} · DNI: {order.signatureDni || '—'}</small></div></div> : <><div className="signature-fields"><label className="field signature-field"><span>Nombre completo</span><input autoFocus value={signatureName} onChange={(event) => setSignatureName(event.target.value)} placeholder="Ingresá tu nombre completo" /></label><label className="field signature-field"><span>DNI</span><input inputMode="numeric" value={signatureDni} onChange={(event) => setSignatureDni(event.target.value)} placeholder="Ingresá tu DNI" /></label></div><label className="check-row"><input type="checkbox" checked={signatureAccepted} onChange={(event) => setSignatureAccepted(event.target.checked)} /><span>Confirmo que revisé la orden de compra y acepto su contenido.</span></label><button type="button" className="button button-primary sign-button" disabled={busy === 'sign' || !signatureName.trim() || !signatureDni.trim() || !signatureAccepted} onClick={handleSignOrder}>{busy === 'sign' ? 'Registrando firma...' : 'Firmar orden y enviar confirmación'} <span>→</span></button></>}</div>}
          {view === 'cliente' && isSigned && <div className="sheet-section client-deliveries-section"><div className="section-heading"><div><span className="section-number">05</span><div><h3>Confirmación de entregas parciales</h3><p>Firmá cada entrega cuando recibas la cantidad indicada.</p></div></div></div>{deliveries.length === 0 ? <div className="empty-deliveries">Todavía no hay entregas parciales registradas.</div> : <div className="client-delivery-list">{deliveries.map((delivery) => <article className="client-delivery-card" key={delivery.id}><div className="client-delivery-card-top"><div><span>Entrega {String(delivery.deliveryNumber).padStart(2, '0')}</span><strong>{delivery.quantity.toLocaleString('es-AR')} equipos</strong><small>{formatDate(delivery.date)}{delivery.shipment ? ` · ${delivery.shipment}` : ''}</small></div><span className={`delivery-status ${delivery.status === 'Entregado' ? 'delivered' : 'transit'}`}><i />{delivery.status}</span></div>{delivery.notes && <p className="client-delivery-notes">{delivery.notes}</p>}{delivery.status === 'Entregado' ? <div className="delivery-confirmed"><strong>Recepción confirmada</strong>{delivery.receivedByName && <small>Firmó: {delivery.receivedByName} · DNI: {delivery.receivedByDni || '—'}</small>}</div> : deliverySignatureId === delivery.id ? <div className="delivery-sign-form"><div className="signature-fields"><label className="field signature-field"><span>Nombre completo</span><input autoFocus value={deliverySignatureName} onChange={(event) => setDeliverySignatureName(event.target.value)} placeholder="Ingresá tu nombre completo" /></label><label className="field signature-field"><span>DNI</span><input inputMode="numeric" value={deliverySignatureDni} onChange={(event) => setDeliverySignatureDni(event.target.value)} placeholder="Ingresá tu DNI" /></label></div><div className="form-actions"><button type="button" className="button button-light" onClick={() => { setDeliverySignatureId(null); setDeliverySignatureName(''); setDeliverySignatureDni(''); }}>Cancelar</button><button type="button" className="button button-primary" disabled={busy === `delivery-sign-${delivery.id}` || !deliverySignatureName.trim() || !deliverySignatureDni.trim()} onClick={handleSignDelivery}>{busy === `delivery-sign-${delivery.id}` ? 'Confirmando...' : 'Firmar recepción'}</button></div></div> : <button type="button" className="button button-primary confirm-delivery-button" onClick={() => { setDeliverySignatureId(delivery.id); setDeliverySignatureName(''); setDeliverySignatureDni(''); }}>Confirmar recepción →</button>}</article>)}</div>}</div>}
          {view === 'interno' && <>{!isSigned ? <div className="locked-section"><div className="lock-icon">⌁</div><div><strong>Seguimiento de entregas parciales</strong><p>Se habilita una vez que el cliente firme la orden.</p></div><span>Bloqueado</span></div> : <div className="sheet-section deliveries-section"><div className="section-heading delivery-heading"><div><span className="section-number">05</span><div><h3>Seguimiento de entregas parciales</h3><p>Registrá cada despacho. El estado cambia cuando el cliente confirma la recepción.</p></div></div><button type="button" className="button button-primary" onClick={() => setIsAddingDelivery(true)} disabled={pendingQuantity === 0}>＋ Agregar entrega</button></div><div className="delivery-summary"><div><strong>{receivedQuantity.toLocaleString('es-AR')} <span>/ {totalQuantity.toLocaleString('es-AR')} equipos recibidos</span></strong><p>{inTransitQuantity.toLocaleString('es-AR')} en tránsito · {pendingQuantity.toLocaleString('es-AR')} pendientes de envío</p></div><strong className="progress-label">{progress}%</strong></div><div className="progress-track"><span style={{ width: `${progress}%` }} /></div>{isAddingDelivery && <div className="new-delivery-form"><div className="form-title"><strong>Registrar entrega parcial</strong><button type="button" onClick={() => setIsAddingDelivery(false)}>×</button></div><div className="delivery-form-grid"><label className="field"><span>Fecha de despacho</span><input type="date" value={newDelivery.date} onChange={(event) => setNewDelivery((current) => ({ ...current, date: event.target.value }))} /></label><label className="field"><span>Cantidad enviada</span><input type="number" min="1" max={pendingQuantity} value={newDelivery.quantity} onChange={(event) => setNewDelivery((current) => ({ ...current, quantity: event.target.value }))} placeholder={`Máximo ${pendingQuantity}`} /></label><label className="field"><span>N.º de despacho/envío</span><input value={newDelivery.shipment} onChange={(event) => setNewDelivery((current) => ({ ...current, shipment: event.target.value }))} placeholder="ENV-00001" /></label><label className="field"><span>Nota fiscal Nro.</span><input value={newDelivery.fiscal} onChange={(event) => setNewDelivery((current) => ({ ...current, fiscal: event.target.value }))} placeholder="NF-000001" /></label><div className="automatic-delivery-state"><span>Estado inicial</span><strong>En tránsito</strong><small>Se actualizará cuando el cliente confirme la recepción.</small></div><label className="field"><span>Observaciones</span><input value={newDelivery.notes} onChange={(event) => setNewDelivery((current) => ({ ...current, notes: event.target.value }))} placeholder="Información adicional" /></label></div><div className="form-actions"><button type="button" className="button button-light" onClick={() => setIsAddingDelivery(false)}>Cancelar</button><button type="button" className="button button-primary" disabled={busy === 'delivery' || !newDelivery.date || !newDelivery.quantity} onClick={handleAddDelivery}>{busy === 'delivery' ? 'Guardando...' : 'Registrar despacho'}</button></div></div>}<div className="table-scroll"><table className="delivery-table"><thead><tr><th>Entrega N.º</th><th>Fecha de despacho</th><th>Cantidad enviada</th><th>Cantidad pendiente</th><th>N.º de despacho/envío</th><th>Nota fiscal Nro.</th><th>Estado</th><th>Observaciones</th></tr></thead><tbody>{deliveries.map((delivery, index) => <tr key={delivery.id}><td><span className="delivery-number">{String(delivery.deliveryNumber || index + 1).padStart(2, '0')}</span></td><td>{formatDate(delivery.date)}</td><td><strong>{delivery.quantity.toLocaleString('es-AR')} u.</strong></td><td>{Math.max(totalQuantity - deliveries.slice(0, index + 1).reduce((sum, current) => sum + current.quantity, 0), 0).toLocaleString('es-AR')} u.</td><td>{delivery.shipment || '—'}</td><td>{delivery.fiscal || '—'}</td><td><span className={`delivery-status ${delivery.status === 'Entregado' ? 'delivered' : 'transit'}`}><i />{delivery.status}</span></td><td>{delivery.notes || '—'}</td></tr>)}</tbody></table>{deliveries.length === 0 && <div className="empty-deliveries">Aún no se registraron entregas parciales.</div>}</div></div>}
            {!isSigned ? <div className="locked-section final-locked"><div className="lock-icon">⌁</div><div><strong>Estado final de la Orden de Compra</strong><p>Se actualiza automáticamente después de la firma.</p></div><span>Bloqueado</span></div> : <div className="sheet-section final-section"><div className="section-heading"><div><span className="section-number">06</span><div><h3>Estado final de la Orden de Compra</h3><p>El sistema lo actualiza según la firma y las entregas registradas.</p></div></div><span className={`sheet-status ${currentFinalStatus === 'Entrega completa' ? 'status-complete' : currentFinalStatus === 'Entrega parcial' ? 'status-partial' : 'status-pending'}`}>{currentFinalStatus}</span></div><div className="automatic-status"><span>✓</span><p>{currentFinalStatus === 'Entrega completa' ? 'La cantidad total de la orden ya fue recibida.' : currentFinalStatus === 'Entrega parcial' ? 'Ya se confirmaron entregas, pero todavía queda cantidad pendiente.' : inTransitQuantity > 0 ? `${inTransitQuantity.toLocaleString('es-AR')} equipos están en tránsito y todavía esperan la confirmación del cliente.` : 'Todavía no se confirmó ninguna entrega para esta orden.'}</p></div></div>}
            <div className="sheet-section general-observations"><div className="section-heading"><div><span className="section-number">07</span><div><h3>Observaciones generales</h3><p>Información adicional de la orden.</p></div></div></div>{canEdit ? <textarea className="main-observations" value={order.generalNotes} onChange={(event) => updateOrder('generalNotes', event.target.value)} rows={5} placeholder="Escribí las observaciones generales..." /> : <p className="readonly-note large-note">{order.generalNotes || '—'}</p>}</div>
            {stage === 'draft' && <div className="sheet-actions"><button type="button" className="button button-light" disabled={busy === 'save'} onClick={handleSaveDraft}>{busy === 'save' ? 'Guardando...' : 'Guardar borrador'}</button><button type="button" className="button button-primary" disabled={busy === 'send'} onClick={handleSendOrder}>{busy === 'send' ? 'Enviando...' : 'Enviar al cliente'} <span>→</span></button></div>}
          </>}
        </section>
          </div>
        </div>
      </main>
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </div>
  );
}
