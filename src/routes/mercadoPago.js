const express = require('express');
const crypto = require('crypto');
const pool = require('../config/database');
const { MercadoPagoConfig, Payment } = require('mercadopago');
const { internalError } = require('../utils/httpError');

const router = express.Router();

const TOLERANCIA_TS_SEG = 600;

function clienteMercadoPago() {
  const token = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  if (!token) {
    return null;
  }
  return new MercadoPagoConfig({ accessToken: token });
}

// Firma de MercadoPago (notificaciones avanzadas): header x-signature con
//  ts=<epoch> y v1=<hmac_sha256 hex>. El manifest a firmar es
//  id:<data.id>;request-id:<x-request-id>;ts:<ts>;
function verificarFirma(req, dataId) {
  const secreto = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  if (!secreto) {
    return { ok: false, motivo: 'no_secreto' };
  }

  const firma = req.get('x-signature') || '';
  const requestId = req.get('x-request-id') || '';
  const partes = {};
  for (const kv of firma.split(',')) {
    const [k, v] = kv.split('=');
    if (k && v) partes[k.trim()] = v.trim();
  }
  const ts = partes.ts;
  const v1 = partes.v1;
  if (!ts || !v1 || !requestId) {
    return { ok: false, motivo: 'firma_incompleta' };
  }

  const dif = Math.abs(Math.floor(Date.now() / 1000) - Number(ts));
  if (Number.isNaN(Number(ts)) || dif > TOLERANCIA_TS_SEG) {
    return { ok: false, motivo: 'firma_expirada' };
  }

  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const esperado = crypto.createHmac('sha256', secreto).update(manifest).digest('hex');
  const largo = Buffer.byteLength(esperado);
  const a = Buffer.from(v1);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || a.length !== largo || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, motivo: 'firma_invalida' };
  }
  return { ok: true };
}

// Notificacion avanzada de pago: { type: 'payment', data: { id } }.
router.post('/webhook', async (req, res) => {
  try {
    const body = req.body || {};
    const dataId = body.data && String(body.data.id);

    if (body.type && body.type !== 'payment') {
      return res.status(200).json({ ok: true });
    }
    if (!dataId) {
      return res.status(400).json({ message: 'Falta el id del pago' });
    }

    const firma = verificarFirma(req, dataId);
    if (!firma.ok) {
      if (firma.motivo === 'no_secreto') {
        return res.status(503).json({ message: 'Webhook no configurado' });
      }
      return res.status(400).json({ message: 'Firma no válida' });
    }

    const client = clienteMercadoPago();
    if (!client) {
      return res.status(503).json({ message: 'Pasarela no configurada' });
    }

    const pago = await new Payment(client).get({ id: dataId });
    const estado = (pago && pago.status) || '';
    const pedidoId = pago && pago.external_reference ? Number(pago.external_reference) : null;
    if (!Number.isInteger(pedidoId) || pedidoId <= 0) {
      return res.status(200).json({ ok: true });
    }

    let nuevoEstado = null;
    if (estado === 'approved') nuevoEstado = 'aprobado';
    else if (estado === 'rejected' || estado === 'cancelled') nuevoEstado = 'rechazado';

    if (nuevoEstado) {
      const resultado = await pool.query(
        `UPDATE pedidos
            SET pago_estado = $1, mp_payment_id = $2,
                updated_at = NOW()
          WHERE id = $3 AND metodo_pago = 'en_linea'
            AND (mp_payment_id IS NULL OR mp_payment_id <> $2)
          RETURNING id`,
        [nuevoEstado, dataId, pedidoId]
      );
      if (resultado.rows.length === 0) {
        // Ya procesado (idempotente) o el pedido no existe: responder 200 siempre.
      }
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    internalError(res, error);
  }
});

module.exports = router;