const jwt = require("jsonwebtoken");
const db = require("./db");
const { onlineModelos, onlineClientes } = require("./state");
const { emitirInboxUpdate, buscarConteudosJaPossuidosPorCliente } = require("./utils/helpers");
const { notificarNovaMensagem } = require("./utils/push");

function setupSocket(io) {
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("Sem token"));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (!decoded?.id || !decoded?.role) return next(new Error("Token inválido"));
      socket.user = { id: decoded.id, role: decoded.role };
      return next();
    } catch (err) {
      console.error("Erro auth socket:", err);
      return next(new Error("Falha na autenticação"));
    }
  });

  io.on("connection", (socket) => {
    console.log("Socket conectado:", socket.id, socket.user);

    socket.on("suporte:entrar", ({ conversa_id }) => {
      if (conversa_id) socket.join(`suporte_${conversa_id}`);
    });
    socket.on("suporte:admin_entrar", () => {
      if (socket.user?.role === "admin") socket.join("suporte_admin");
    });
    socket.on("suporte:admin_entrar_conversa", ({ conversa_id }) => {
      if (socket.user?.role === "admin" && conversa_id) socket.join(`suporte_${conversa_id}`);
    });
    socket.on("suporte:typing", ({ conversa_id }) => {
      if (socket.user?.role === "admin" && conversa_id) {
        io.to(`suporte_${conversa_id}`).emit("suporte:typing");
      }
    });

    socket.on("loginModelo", async () => {
      try {
        if (!socket.user || socket.user.role !== "modelo") return socket.disconnect();
        const result = await db.query("SELECT id FROM modelos WHERE user_id=$1", [socket.user.id]);
        if (result.rowCount === 0) return;
        const modeloIdReal = result.rows[0].id;
        socket.modelo_id = modeloIdReal;
        if (!onlineModelos.has(modeloIdReal)) onlineModelos.set(modeloIdReal, new Set());
        onlineModelos.get(modeloIdReal).add(socket.id);
        console.log("Modelo online:", modeloIdReal);
      } catch (err) {
        console.error("Erro loginModelo:", err);
      }
    });

    socket.on("loginCliente", async () => {
      try {
        if (!socket.user || socket.user.role !== "cliente") return socket.disconnect();
        const clienteRes = await db.query("SELECT id FROM clientes WHERE user_id=$1", [socket.user.id]);
        if (!clienteRes.rowCount) return;
        const clienteIdReal = clienteRes.rows[0].id;
        socket.cliente_id = clienteIdReal;
        if (!onlineClientes.has(clienteIdReal)) onlineClientes.set(clienteIdReal, new Set());
        onlineClientes.get(clienteIdReal).add(socket.id);
        console.log("Cliente online:", clienteIdReal, socket.id);
      } catch (err) {
        console.error("Erro loginCliente:", err);
      }
    });

    socket.on("joinChat", async ({ cliente_id, modelo_id } = {}, callback) => {
      try {
        if (!socket.user) { callback?.({ ok: false, error: "Usuário não autenticado" }); return; }
        cliente_id = Number(cliente_id);
        modelo_id = Number(modelo_id);
        if (!Number.isInteger(cliente_id) || !Number.isInteger(modelo_id)) { callback?.({ ok: false, error: "IDs inválidos" }); return; }

        if (socket.user.role === "cliente") {
          const clienteRes = await db.query("SELECT id FROM clientes WHERE user_id=$1", [socket.user.id]);
          if (clienteRes.rowCount === 0) { callback?.({ ok: false, error: "Cliente não encontrado" }); return; }
          if (clienteRes.rows[0].id !== cliente_id) { callback?.({ ok: false, error: "Cliente inválido" }); return; }
          const vipRes = await db.query(`SELECT 1 FROM vip_subscriptions WHERE cliente_id=$1 AND modelo_id=$2 AND ativo=true AND expiration_at>NOW() LIMIT 1`, [cliente_id, modelo_id]);
          if (vipRes.rowCount === 0) { callback?.({ ok: false, error: "vip_required" }); return; }
        } else if (socket.user.role === "modelo") {
          const modeloRes = await db.query("SELECT id FROM modelos WHERE user_id=$1", [socket.user.id]);
          if (modeloRes.rowCount === 0) { callback?.({ ok: false, error: "Modelo não encontrado" }); return; }
          if (modeloRes.rows[0].id !== modelo_id) { callback?.({ ok: false, error: "Modelo inválido" }); return; }
        } else {
          callback?.({ ok: false, error: "Role inválida" }); return;
        }

        const sala = `chat_${cliente_id}_${modelo_id}`;
        socket.join(sala);
        console.log("Entrou na sala:", sala);
        callback?.({ ok: true, sala });
      } catch (err) {
        console.error("Erro no joinChat:", err);
        callback?.({ ok: false, error: "Erro interno" });
      }
    });

    socket.on("joinInbox", async (payload, callback) => {
      try {
        if (typeof payload === "function") { callback = payload; payload = {}; }
        if (!socket.user) { callback?.({ ok: false, error: "Usuário não autenticado" }); return; }

        if (socket.user.role === "cliente") {
          const clienteRes = await db.query("SELECT id FROM clientes WHERE user_id=$1", [socket.user.id]);
          if (!clienteRes.rowCount) { callback?.({ ok: false, error: "Cliente não encontrado" }); return; }
          const cliente_id = clienteRes.rows[0].id;
          const sala = `inbox_cliente_${cliente_id}`;
          socket.join(sala);
          callback?.({ ok: true, sala, tipo: "cliente" });
          return;
        }
        if (socket.user.role === "modelo") {
          const modeloRes = await db.query("SELECT id FROM modelos WHERE user_id=$1", [socket.user.id]);
          if (!modeloRes.rowCount) { callback?.({ ok: false, error: "Modelo não encontrado" }); return; }
          const modelo_id = modeloRes.rows[0].id;
          const sala = `inbox_modelo_${modelo_id}`;
          socket.join(sala);
          callback?.({ ok: true, sala, tipo: "modelo" });
          return;
        }
        callback?.({ ok: false, error: "Role inválida" });
      } catch (err) {
        console.error("Erro no joinInbox:", err);
        callback?.({ ok: false, error: "Erro interno" });
      }
    });

    socket.on("disconnect", async () => {
      console.log("Socket desconectado:", socket.id);
      try {
        if (socket.cliente_id) {
          const set = onlineClientes.get(socket.cliente_id);
          if (set) {
            set.delete(socket.id);
            if (set.size === 0) {
              onlineClientes.delete(socket.cliente_id);
              await db.query(`UPDATE clientes SET last_seen=NOW() WHERE id=$1`, [socket.cliente_id]);
              console.log("Cliente offline:", socket.cliente_id);
            }
          }
        }
        if (socket.modelo_id) {
          const set = onlineModelos.get(socket.modelo_id);
          if (set) {
            set.delete(socket.id);
            if (set.size === 0) {
              onlineModelos.delete(socket.modelo_id);
              await db.query(`UPDATE modelos SET last_seen=NOW() WHERE id=$1`, [socket.modelo_id]);
              console.log("Modelo offline:", socket.modelo_id);
            }
          }
        }
      } catch (err) {
        console.error("Erro no disconnect:", err);
      }
    });

    socket.on("sendMessage", async (data, callback) => {
      const { cliente_id, modelo_id, text, tempId } = data || {};
      const clienteIdNum = Number(cliente_id);
      const modeloIdNum = Number(modelo_id);

      if (!socket.user) { callback?.({ ok: false }); return; }
      if (!Number.isInteger(clienteIdNum) || !Number.isInteger(modeloIdNum) || !text || typeof text !== "string") { callback?.({ ok: false }); return; }

      try {
        if (socket.user.role === "cliente") {
          const clienteRes = await db.query("SELECT id FROM clientes WHERE user_id=$1", [socket.user.id]);
          if (!clienteRes.rowCount) { callback?.({ ok: false }); return; }
          if (clienteRes.rows[0].id !== clienteIdNum) { callback?.({ ok: false }); return; }
          const vipCheck = await db.query(`SELECT 1 FROM vip_subscriptions WHERE cliente_id=$1 AND modelo_id=$2 AND ativo=true AND expiration_at>NOW() LIMIT 1`, [clienteIdNum, modeloIdNum]);
          if (vipCheck.rowCount === 0) { callback?.({ ok: false, error: "vip_required" }); return; }
        } else if (socket.user.role === "modelo") {
          const modeloRes = await db.query("SELECT id FROM modelos WHERE user_id=$1", [socket.user.id]);
          if (!modeloRes.rowCount) { callback?.({ ok: false }); return; }
          if (modeloRes.rows[0].id !== modeloIdNum) { callback?.({ ok: false }); return; }
        } else {
          callback?.({ ok: false }); return;
        }

        const sala = `chat_${clienteIdNum}_${modeloIdNum}`;
        const sender = socket.user.role;
        const unreadFor = sender === "cliente" ? "modelo" : "cliente";

        const result = await db.query(
          `INSERT INTO messages (cliente_id, modelo_id, sender, tipo, text, visto) VALUES ($1,$2,$3,'texto',$4,false) RETURNING id, created_at`,
          [clienteIdNum, modeloIdNum, sender, text]
        );
        const message = result.rows[0];

        await db.query(
          `INSERT INTO unread (cliente_id, modelo_id, unread_for, has_unread) VALUES ($1,$2,$3,true) ON CONFLICT (cliente_id, modelo_id) DO UPDATE SET unread_for=EXCLUDED.unread_for, has_unread=true`,
          [clienteIdNum, modeloIdNum, unreadFor]
        );

        io.to(sala).emit("newMessage", {
          id: message.id, tempId, cliente_id: clienteIdNum, modelo_id: modeloIdNum,
          sender, tipo: "texto", text, visto: false, created_at: message.created_at
        });

        emitirInboxUpdate(io, { cliente_id: clienteIdNum, modelo_id: modeloIdNum, sender, text, created_at: message.created_at });

        try {
          let userIdDestino = null;
          let pushUrl = "/inbox.html";
          let remetente = "Nova mensagem";
          if (sender === "cliente") {
            const modeloDestinoRes = await db.query(`SELECT user_id FROM modelos WHERE id=$1 LIMIT 1`, [modeloIdNum]);
            userIdDestino = modeloDestinoRes.rows[0]?.user_id || null;
            const nomeRes = await db.query(`SELECT nome FROM clientes WHERE id=$1 LIMIT 1`, [clienteIdNum]);
            remetente = nomeRes.rows[0]?.nome || "Cliente";
          } else if (sender === "modelo") {
            const clienteDestinoRes = await db.query(`SELECT user_id FROM clientes WHERE id=$1 LIMIT 1`, [clienteIdNum]);
            userIdDestino = clienteDestinoRes.rows[0]?.user_id || null;
            pushUrl = "/inboxc.html";
            const nomeRes = await db.query(`SELECT nome_exibicao FROM modelos WHERE id=$1 LIMIT 1`, [modeloIdNum]);
            remetente = nomeRes.rows[0]?.nome_exibicao || "Mensagem";
          }
          if (userIdDestino) {
            await notificarNovaMensagem(userIdDestino, text.trim() ? text.trim().slice(0, 120) : "Você recebeu uma nova mensagem", pushUrl, remetente);
          }
        } catch (pushErr) {
          console.error("Erro ao disparar push de mensagem:", pushErr);
        }

        callback?.({ ok: true, message_id: message.id, tempId });
      } catch (err) {
        console.error("ERRO AO SALVAR MENSAGEM:", err);
        callback?.({ ok: false });
      }
    });

    socket.on("getHistory", async ({ cliente_id, modelo_id, offset = 0, limit = 20 } = {}) => {
      const clienteIdNum = Number(cliente_id);
      const modeloIdNum = Number(modelo_id);
      const offsetNum = Number(offset);
      const limitNum = Number(limit);
      if (!socket.user || !Number.isInteger(clienteIdNum) || !Number.isInteger(modeloIdNum) || !Number.isInteger(offsetNum) || !Number.isInteger(limitNum)) return;

      try {
        if (socket.user.role === "cliente") {
          const clienteRes = await db.query("SELECT id FROM clientes WHERE user_id=$1", [socket.user.id]);
          if (!clienteRes.rowCount || clienteRes.rows[0].id !== clienteIdNum) return;
        } else if (socket.user.role === "modelo") {
          const modeloRes = await db.query("SELECT id FROM modelos WHERE user_id=$1", [socket.user.id]);
          if (!modeloRes.rowCount || modeloRes.rows[0].id !== modeloIdNum) return;
        } else return;

        await db.query(`UPDATE unread SET has_unread=false WHERE cliente_id=$1 AND modelo_id=$2 AND unread_for=$3`, [clienteIdNum, modeloIdNum, socket.user.role]);

        if (socket.user.role === "modelo") {
          await db.query(`UPDATE messages SET lida=true WHERE cliente_id=$1 AND modelo_id=$2 AND sender='cliente' AND lida=false`, [clienteIdNum, modeloIdNum]);
          io.to(`inbox_modelo_${modeloIdNum}`).emit("unreadUpdate");
        }
        if (socket.user.role === "cliente") {
          await db.query(`UPDATE messages SET lida=true WHERE cliente_id=$1 AND modelo_id=$2 AND sender='modelo' AND lida=false`, [clienteIdNum, modeloIdNum]);
          await db.query(`UPDATE clientes SET last_seen=NOW() WHERE id=$1`, [clienteIdNum]);
          io.to(`inbox_modelo_${modeloIdNum}`).emit("mensagemLida", { cliente_id: clienteIdNum, modelo_id: modeloIdNum });
        }

        const result = await db.query(
          `SELECT id, cliente_id, modelo_id, sender, text, tipo, preco, visto, conteudo_id, pacote_id, created_at
           FROM messages WHERE cliente_id=$1 AND modelo_id=$2 AND deletada IS NOT TRUE
           ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
          [clienteIdNum, modeloIdNum, limitNum, offsetNum]
        );
        const mensagens = result.rows.reverse();

        const mensagensConteudo = mensagens.filter(m => m.tipo === "conteudo" || m.tipo === "conteudo_ppv_mass");
        const messageIds = mensagensConteudo.map(m => m.id);

        if (messageIds.length > 0) {
          const midiasRes = await db.query(
            `SELECT mc.message_id, mc.conteudo_id, c.url, c.thumbnail_url, c.tipo AS tipo_media FROM messages_conteudos mc JOIN conteudos c ON c.id=mc.conteudo_id WHERE mc.message_id=ANY($1)`,
            [messageIds]
          );
          const mapaMidias = {};
          for (const row of midiasRes.rows) {
            if (!mapaMidias[row.message_id]) mapaMidias[row.message_id] = [];
            mapaMidias[row.message_id].push({ conteudo_id: Number(row.conteudo_id), url: row.url, thumbnail_url: row.thumbnail_url, tipo_media: row.tipo_media });
          }

          const pagosRes = await db.query(
            `SELECT message_id FROM conteudo_pacotes WHERE message_id=ANY($1) AND cliente_id=$2 AND status='pago'`,
            [messageIds, clienteIdNum]
          );
          const pagosSet = new Set(pagosRes.rows.map(r => Number(r.message_id)));
          const conteudosPossuidosSet = await buscarConteudosJaPossuidosPorCliente(db, { cliente_id: clienteIdNum, modelo_id: modeloIdNum });

          for (const msg of mensagensConteudo) {
            const midias = mapaMidias[msg.id] || [];
            const pago = Number(msg.preco) > 0 ? pagosSet.has(Number(msg.id)) : true;
            const liberado = msg.visto === true || pago;
            const ehMass = msg.tipo === "conteudo_ppv_mass";

            msg.midias = midias.map(m => {
              const conteudoId = Number(m.conteudo_id);
              const jaPossuia = conteudosPossuidosSet.has(conteudoId);
              const liberadoItem = liberado || (ehMass && jaPossuia);
              return { conteudo_id: conteudoId, url: liberadoItem ? m.url : null, thumbnail_url: m.thumbnail_url, tipo_media: m.tipo_media, liberado: liberadoItem, bloqueado: !liberadoItem, ja_possuia: jaPossuia };
            });
            msg.pago = pago;
            msg.liberado = liberado;
          }
        }

        socket.emit("chatHistory", mensagens);
      } catch (err) {
        console.error("Erro ao buscar histórico:", err);
      }
    });

    socket.on("sendConteudo", async ({ cliente_id, modelo_id, conteudos, preco, tipo_envio, tempId } = {}, callback) => {
      try {
        if (!socket.user || socket.user.role !== "modelo") { callback?.({ ok: false, error: "Apenas modelos podem enviar conteúdo" }); return; }

        const clienteIdNum = Number(cliente_id);
        const modeloIdNum = Number(modelo_id);
        if (!Number.isInteger(clienteIdNum) || !Number.isInteger(modeloIdNum)) { callback?.({ ok: false, error: "IDs inválidos" }); return; }

        const modeloRes = await db.query("SELECT id FROM modelos WHERE user_id=$1", [socket.user.id]);
        if (!modeloRes.rowCount || modeloRes.rows[0].id !== modeloIdNum) { callback?.({ ok: false, error: "Modelo inválido" }); return; }

        const precoNum = tipo_envio === "venda" ? Number(preco || 0) : 0;
        const tipoMensagem = tipo_envio === "venda" ? "conteudo" : "conteudo";
        const visto = tipo_envio !== "venda";

        const msgRes = await db.query(
          `INSERT INTO messages (cliente_id, modelo_id, sender, tipo, preco, visto, created_at) VALUES ($1,$2,'modelo',$3,$4,$5,NOW()) RETURNING id, created_at`,
          [clienteIdNum, modeloIdNum, tipoMensagem, precoNum, visto]
        );
        const messageId = msgRes.rows[0].id;
        const createdAt = msgRes.rows[0].created_at;

        if (Array.isArray(conteudos)) {
          for (const conteudoId of conteudos) {
            await db.query(
              `INSERT INTO messages_conteudos (message_id, conteudo_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
              [messageId, Number(conteudoId)]
            );
          }
        }

        await db.query(
          `INSERT INTO unread (cliente_id, modelo_id, unread_for, has_unread) VALUES ($1,$2,'cliente',true) ON CONFLICT (cliente_id, modelo_id) DO UPDATE SET unread_for='cliente', has_unread=true`,
          [clienteIdNum, modeloIdNum]
        );

        const sala = `chat_${clienteIdNum}_${modeloIdNum}`;
        const midiasRes = await db.query(
          `SELECT mc.conteudo_id, c.url, c.thumbnail_url, c.tipo AS tipo_media FROM messages_conteudos mc JOIN conteudos c ON c.id=mc.conteudo_id WHERE mc.message_id=$1`,
          [messageId]
        );

        io.to(sala).emit("newMessage", {
          id: messageId, tempId, cliente_id: clienteIdNum, modelo_id: modeloIdNum,
          sender: "modelo", tipo: tipoMensagem, preco: precoNum, visto, created_at: createdAt,
          midias: midiasRes.rows.map(m => ({ conteudo_id: Number(m.conteudo_id), url: visto ? m.url : null, thumbnail_url: m.thumbnail_url, tipo_media: m.tipo_media, liberado: visto, bloqueado: !visto }))
        });

        emitirInboxUpdate(io, { cliente_id: clienteIdNum, modelo_id: modeloIdNum, sender: "modelo", text: "📎 Conteúdo", created_at: createdAt });
        callback?.({ ok: true, message_id: messageId, tempId });
      } catch (err) {
        console.error("Erro sendConteudo:", err);
        callback?.({ ok: false });
      }
    });

    socket.on("marcarConteudoVisto", async ({ message_id, cliente_id, modelo_id } = {}) => {
      try {
        if (!socket.user || socket.user.role !== "cliente") return;
        const clienteRes = await db.query("SELECT id FROM clientes WHERE user_id=$1", [socket.user.id]);
        if (!clienteRes.rowCount || clienteRes.rows[0].id !== Number(cliente_id)) return;

        await db.query(`UPDATE messages SET visto=true, updated_at=NOW() WHERE id=$1 AND cliente_id=$2`, [Number(message_id), Number(cliente_id)]);

        const sala = `chat_${cliente_id}_${modelo_id}`;
        io.to(sala).emit("conteudoVisto", { message_id: Number(message_id) });
      } catch (err) {
        console.error("Erro marcarConteudoVisto:", err);
      }
    });

    socket.on("editarMensagem", async ({ id, text } = {}) => {
      try {
        if (!socket.user || socket.user.role !== "modelo") return;
        if (!id || !text || typeof text !== "string") return;

        const messageId = Number(id);
        const modeloRes = await db.query("SELECT id FROM modelos WHERE user_id=$1", [socket.user.id]);
        if (!modeloRes.rowCount) return;
        const modeloIdReal = modeloRes.rows[0].id;

        const upd = await db.query(
          `UPDATE messages SET text=$1, updated_at=NOW() WHERE id=$2 AND modelo_id=$3 RETURNING cliente_id, modelo_id`,
          [text.trim(), messageId, modeloIdReal]
        );
        if (upd.rowCount === 0) return;

        const { cliente_id, modelo_id } = upd.rows[0];
        const sala = `chat_${cliente_id}_${modelo_id}`;
        io.to(sala).emit("mensagemEditada", { id: messageId, text: text.trim() });
      } catch (err) {
        console.error("Erro ao editar mensagem:", err);
      }
    });

    socket.on("excluirMensagem", async ({ id } = {}) => {
      try {
        if (!socket.user || socket.user.role !== "modelo") return;
        const messageId = Number(id);
        const modeloRes = await db.query("SELECT id FROM modelos WHERE user_id=$1", [socket.user.id]);
        if (!modeloRes.rowCount) return;
        const modeloIdReal = modeloRes.rows[0].id;

        const del = await db.query(
          `UPDATE messages SET deletada=true WHERE id=$1 AND modelo_id=$2 AND sender='modelo' RETURNING cliente_id, modelo_id`,
          [messageId, modeloIdReal]
        );
        if (del.rowCount === 0) return;

        const sala = `chat_${del.rows[0].cliente_id}_${del.rows[0].modelo_id}`;
        io.to(sala).emit("mensagemExcluida", { id: messageId });
      } catch (err) {
        console.error("Erro ao excluir mensagem:", err);
      }
    });
  });
}

module.exports = { setupSocket };
