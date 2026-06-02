const db = require("../db");

async function marcarConteudoComoLiberadoPorPagamento(client, { message_id, cliente_id, modelo_id }) {
  const mid = Number(message_id);
  const cid = Number(cliente_id);
  const moid = Number(modelo_id);

  if (!Number.isInteger(mid) || mid <= 0) throw new Error("message_id inválido");
  if (!Number.isInteger(cid) || cid <= 0) throw new Error("cliente_id inválido");
  if (!Number.isInteger(moid) || moid <= 0) throw new Error("modelo_id inválido");

  const up = await client.query(
    `UPDATE messages
     SET visto = true, updated_at = NOW()
     WHERE id = $1 AND cliente_id = $2 AND modelo_id = $3
     RETURNING id`,
    [mid, cid, moid]
  );

  if (!up.rowCount) {
    throw new Error("messages não encontrada / não pertence ao cliente/modelo");
  }

  const conteudos = await client.query(
    `SELECT mc.conteudo_id FROM messages_conteudos mc WHERE mc.message_id = $1`,
    [mid]
  );

  return conteudos.rows
    .map(r => Number(r.conteudo_id))
    .filter(n => Number.isInteger(n) && n > 0);
}

async function buscarUnreadCliente(cliente_id) {
  if (!cliente_id || !Number.isInteger(cliente_id)) {
    throw new Error("cliente_id inválido");
  }

  const result = await db.query(
    `SELECT u.modelo_id
     FROM unread u
     JOIN vip_subscriptions v
       ON v.cliente_id = u.cliente_id
      AND v.modelo_id  = u.modelo_id
      AND v.ativo = true
      AND v.expiration_at > NOW()
     WHERE u.cliente_id  = $1
       AND u.unread_for  = 'cliente'
       AND u.has_unread  = true`,
    [cliente_id]
  );

  return result.rows.map(r => r.modelo_id);
}

async function buscarUnreadModelo(modelo_id) {
  if (!modelo_id || !Number.isInteger(modelo_id)) {
    throw new Error("modelo_id inválido");
  }

  const result = await db.query(
    `SELECT u.cliente_id
     FROM unread u
     JOIN vip_subscriptions v
       ON v.cliente_id = u.cliente_id
      AND v.modelo_id  = u.modelo_id
      AND v.ativo = true
      AND v.expiration_at > NOW()
     WHERE u.modelo_id  = $1
       AND u.unread_for = 'modelo'
       AND u.has_unread = true`,
    [modelo_id]
  );

  return result.rows.map(r => r.cliente_id);
}

function emitirInboxUpdate(io, { cliente_id, modelo_id, sender, text, created_at }) {
  const payload = {
    cliente_id,
    modelo_id,
    ultima_mensagem: text,
    ultima_mensagem_em: created_at,
    sender,
    visto: false,
    lida: false
  };

  io.to(`inbox_modelo_${modelo_id}`).emit("inboxMessage", payload);
  io.to(`inbox_cliente_${cliente_id}`).emit("inboxMessage", payload);
}

async function buscarConteudosJaPossuidosPorCliente(dbOrClient, { cliente_id, modelo_id }) {
  const result = await dbOrClient.query(
    `SELECT DISTINCT mc.conteudo_id
     FROM messages m
     JOIN messages_conteudos mc ON mc.message_id = m.id
     LEFT JOIN conteudo_pacotes cp
       ON cp.message_id = m.id AND cp.cliente_id = $1 AND cp.status = 'pago'
     WHERE m.modelo_id = $2
       AND m.cliente_id = $1
       AND (m.visto = true OR cp.id IS NOT NULL)`,
    [cliente_id, modelo_id]
  );

  return new Set(result.rows.map(r => Number(r.conteudo_id)));
}

module.exports = {
  marcarConteudoComoLiberadoPorPagamento,
  buscarUnreadCliente,
  buscarUnreadModelo,
  emitirInboxUpdate,
  buscarConteudosJaPossuidosPorCliente
};
