const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const db = require('../db');

const ADMIN_EMAIL_CONFIG = {};
const ADMIN_EMAIL_IMAP = {}; // Manter conexões ativas

async function getEmailConfig(adminId) {
  try {
    const res = await db.query(
      'SELECT email_config FROM admin WHERE id = $1',
      [adminId]
    );
    if (res.rows.length && res.rows[0].email_config) {
      const config = res.rows[0].email_config;
      // JSONB retorna como objeto, não como string
      if (typeof config === 'string') {
        return JSON.parse(config);
      }
      return config;
    }
  } catch (err) {
    console.error('Erro ao recuperar config de email:', err);
  }
  return null;
}

async function saveEmailConfig(adminId, config) {
  try {
    await db.query(
      `UPDATE admin
       SET email_config = $1
       WHERE id = $2`,
      [config ? JSON.stringify(config) : null, adminId]
    );
  } catch (err) {
    console.error('Erro ao salvar config de email:', err);
  }
}

router.post('/config', async (req, res) => {
  try {
    const adminId = req.user?.id;
    console.log('[EMAIL] Config request - adminId:', adminId, 'body:', req.body);

    if (!adminId) return res.status(401).json({ erro: 'Não autenticado' });

    const { email, senha, imap_host, imap_port, smtp_host, smtp_port, use_tls } = req.body;

    console.log('[EMAIL] Dados recebidos:', { email, senha: '***', imap_host, imap_port, smtp_host, smtp_port, use_tls });

    if (!email || !senha) {
      return res.status(400).json({ erro: 'Email e senha são obrigatórios' });
    }

    const testConfig = {
      email,
      senha,
      imap_host: imap_host || 'mail.seudominio.com',
      imap_port: imap_port || 993,
      smtp_host: smtp_host || 'mail.seudominio.com',
      smtp_port: smtp_port || 587,
      use_tls: use_tls !== false
    };

    console.log('[EMAIL] Testando config:', {
      email: testConfig.email,
      host: testConfig.imap_host,
      port: testConfig.imap_port,
      tls: testConfig.use_tls
    });

    const imap = new Imap({
      user: testConfig.email,
      password: testConfig.senha,
      host: testConfig.imap_host,
      port: testConfig.imap_port,
      tls: testConfig.use_tls,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 10000,
      authTimeout: 10000
    });

    await new Promise((resolve, reject) => {
      imap.on('error', (err) => {
        console.error('[EMAIL CONFIG] Erro IMAP:', err.message);
        reject(err);
      });

      imap.on('ready', () => {
        console.log('[EMAIL CONFIG] Conectado com sucesso, testando acesso...');
        imap.openBox('INBOX', false, (err, box) => {
          if (err) {
            imap.end();
            reject(err);
          } else {
            console.log('[EMAIL CONFIG] INBOX acessível');
            imap.end();
            resolve();
          }
        });
      });

      console.log('[EMAIL CONFIG] Conectando ao IMAP...');
      imap.connect();
    });

    await saveEmailConfig(adminId, testConfig);
    ADMIN_EMAIL_CONFIG[adminId] = testConfig;

    res.json({
      sucesso: true,
      mensagem: 'Email configurado com sucesso',
      email: testConfig.email
    });
  } catch (err) {
    console.error('[EMAIL] Erro ao configurar email:', err.message, err.stack);
    res.status(400).json({
      erro: err.message || 'Erro ao conectar ao email. Verifique suas credenciais.',
      debug: err.message
    });
  }
});

router.post('/disconnect', async (req, res) => {
  try {
    const adminId = req.user?.id;
    if (!adminId) return res.status(401).json({ erro: 'Não autenticado' });

    await saveEmailConfig(adminId, null);
    delete ADMIN_EMAIL_CONFIG[adminId];

    res.json({ sucesso: true, mensagem: 'Email desconectado' });
  } catch (err) {
    res.status(400).json({ erro: err.message });
  }
});

router.post('/sync', async (req, res) => {
  const adminId = req.user?.id;
  if (!adminId) return res.status(401).json({ erro: 'Não autenticado' });

  let config = ADMIN_EMAIL_CONFIG[adminId];
  if (!config) {
    try {
      config = await getEmailConfig(adminId);
    } catch (err) {
      console.error('[EMAIL SYNC] Erro ao carregar config:', err.message);
      return res.status(500).json({ erro: 'Erro ao carregar configuração' });
    }

    if (!config) {
      return res.status(400).json({ erro: 'Email não configurado' });
    }
  }

  const emails = [];
  let imap;

  try {
    // Timeout total de 25 segundos
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Sincronização excedeu tempo limite')), 25000)
    );

    const syncPromise = new Promise((resolve, reject) => {
      imap = new Imap({
        user: config.email,
        password: config.senha,
        host: config.imap_host,
        port: config.imap_port,
        tls: config.use_tls,
        tlsOptions: { rejectUnauthorized: false },
        connTimeout: 8000,
        authTimeout: 8000
      });

      imap.on('error', reject);

      imap.on('ready', () => {
        console.log('[EMAIL SYNC] Conectado, abrindo INBOX...');

        imap.openBox('INBOX', false, (err, box) => {
          if (err) {
            imap.end();
            return reject(err);
          }

          console.log('[EMAIL SYNC] INBOX aberta, mensagens:', box.messages.total);

          if (box.messages.total === 0) {
            imap.end();
            console.log('[EMAIL SYNC] INBOX vazia');
            return resolve();
          }

          const range = box.messages.total > 20
            ? box.messages.total - 19 + ':' + box.messages.total
            : '1:*';

          console.log('[EMAIL SYNC] Range a buscar:', range, '(total:', box.messages.total, ')');

          const f = imap.seq.fetch(range, { bodies: '' });

          f.on('message', (msg, seqno) => {
            console.log('[EMAIL SYNC] Mensagem encontrada - seqno:', seqno);

            // Converter stream em buffer para evitar erro de pipe
            const chunks = [];
            msg.on('body', (stream, info) => {
              stream.on('data', (chunk) => {
                chunks.push(chunk);
              });

              stream.on('end', async () => {
                try {
                  const buffer = Buffer.concat(chunks);
                  console.log('[EMAIL SYNC] Parsing seqno:', seqno, '(', buffer.length, 'bytes)');

                  const parsed = await simpleParser(buffer);

                  console.log('[EMAIL SYNC] ✓ Parsed seqno:', seqno, 'from:', parsed.from?.text?.substring(0, 30));

                  emails.push({
                    id: seqno,
                    from: parsed.from?.text || 'Desconhecido',
                    to: parsed.to?.text || '',
                    subject: parsed.subject || '(sem assunto)',
                    text: parsed.text?.substring(0, 200) || '',
                    html: parsed.html?.substring(0, 500) || '',
                    date: parsed.date,
                    full_text: parsed.text || '',
                    full_html: parsed.html || ''
                  });
                } catch (parseErr) {
                  console.error('[EMAIL SYNC] ✗ Erro parsing seqno:', seqno, '-', parseErr.message);
                }
              });
            });

            msg.on('attributes', (attrs) => {
              console.log('[EMAIL SYNC] Attrs seqno:', seqno, '- uid:', attrs.uid);
            });
          });

          f.on('error', (err) => {
            console.error('[EMAIL SYNC] Erro no fetch:', err.message);
            reject(err);
          });

          f.on('end', async () => {
            console.log('[EMAIL SYNC] Fetch finalizado, total parseado:', emails.length);
            setTimeout(() => {
              imap.end();
              resolve();
            }, 1000);
          });
        });
      });

      imap.connect();
    });

    // Race condition: executa o que terminar primeiro (sucesso ou timeout)
    await Promise.race([syncPromise, timeoutPromise]);

    console.log('[EMAIL SYNC] ✓ Sincronizado com sucesso:', emails.length, 'emails retornados');
    console.log('[EMAIL SYNC] Dados:', JSON.stringify(emails.slice(0, 2), null, 2));

    res.json({
      sucesso: true,
      total: emails.length,
      emails
    });

  } catch (err) {
    console.error('[EMAIL SYNC] ✗ Erro:', err.message);
    if (imap) imap.end();

    res.status(400).json({
      erro: err.message || 'Erro ao sincronizar emails'
    });
  }
});

router.post('/send', async (req, res) => {
  try {
    const adminId = req.user?.id;
    if (!adminId) return res.status(401).json({ erro: 'Não autenticado' });

    const { para, assunto, corpo } = req.body;

    if (!para || !assunto || !corpo) {
      return res.status(400).json({ erro: 'Campos obrigatórios faltando' });
    }

    let config = ADMIN_EMAIL_CONFIG[adminId];
    if (!config) {
      config = await getEmailConfig(adminId);
      if (!config) {
        return res.status(400).json({ erro: 'Email não configurado' });
      }
    }

    const transporter = nodemailer.createTransport({
      host: config.smtp_host,
      port: config.smtp_port,
      secure: config.use_tls && config.smtp_port === 465,
      auth: {
        user: config.email,
        pass: config.senha
      },
      tls: config.use_tls ? { rejectUnauthorized: false } : false
    });

    await transporter.sendMail({
      from: config.email,
      to: para,
      subject: assunto,
      html: corpo.replace(/\n/g, '<br>')
    });

    res.json({ sucesso: true, mensagem: 'Email enviado com sucesso' });
  } catch (err) {
    console.error('Erro ao enviar email:', err);
    res.status(400).json({
      erro: err.message || 'Erro ao enviar email'
    });
  }
});

router.post('/archive', async (req, res) => {
  try {
    const adminId = req.user?.id;
    if (!adminId) return res.status(401).json({ erro: 'Não autenticado' });

    const { id } = req.body;
    if (!id) return res.status(400).json({ erro: 'ID do email é obrigatório' });

    let config = ADMIN_EMAIL_CONFIG[adminId];
    if (!config) {
      config = await getEmailConfig(adminId);
      if (!config) {
        return res.status(400).json({ erro: 'Email não configurado' });
      }
    }

    await new Promise((resolve, reject) => {
      const imap = new Imap({
        user: config.email,
        password: config.senha,
        host: config.imap_host,
        port: config.imap_port,
        tls: config.use_tls,
        tlsOptions: { rejectUnauthorized: false },
        connTimeout: 8000,
        authTimeout: 8000
      });

      imap.on('error', reject);
      imap.on('ready', () => {
        console.log('[EMAIL ARCHIVE] Conectado, abrindo INBOX...');

        imap.openBox('INBOX', false, (err, box) => {
          if (err) {
            imap.end();
            return reject(err);
          }

          console.log('[EMAIL ARCHIVE] Marcando email', id, 'para mover...');

          imap.addFlags(id, ['\\Deleted'], (err) => {
            if (err) {
              imap.end();
              return reject(err);
            }

            console.log('[EMAIL ARCHIVE] Expurgando (deletando)...');
            imap.expunge((err) => {
              imap.end();
              if (err) reject(err);
              else {
                console.log('[EMAIL ARCHIVE] ✓ Email arquivado');
                resolve();
              }
            });
          });
        });
      });

      imap.connect();
    });

    res.json({ sucesso: true, mensagem: 'Email arquivado' });
  } catch (err) {
    console.error('[EMAIL ARCHIVE] Erro:', err.message);
    res.status(400).json({ erro: err.message || 'Erro ao arquivar email' });
  }
});

router.get('/sent', async (req, res) => {
  try {
    const adminId = req.user?.id;
    if (!adminId) return res.status(401).json({ erro: 'Não autenticado' });

    let config = ADMIN_EMAIL_CONFIG[adminId];
    if (!config) {
      config = await getEmailConfig(adminId);
      if (!config) {
        return res.status(400).json({ erro: 'Email não configurado' });
      }
    }

    const emails = [];

    await new Promise((resolve, reject) => {
      const imap = new Imap({
        user: config.email,
        password: config.senha,
        host: config.imap_host,
        port: config.imap_port,
        tls: config.use_tls,
        tlsOptions: { rejectUnauthorized: false },
        connTimeout: 8000,
        authTimeout: 8000
      });

      imap.on('error', reject);

      imap.on('ready', () => {
        console.log('[EMAIL SENT] Abrindo pasta Sent...');

        // Tentar diferentes nomes de pasta
        const sentFolders = ['Sent', '[Gmail]/Sent Mail', 'Enviados', 'INBOX.Sent'];
        let folderFound = false;

        imap.getBoxes((err, boxes) => {
          if (err) return reject(err);

          let targetFolder = null;
          const searchFolder = (box, path = '') => {
            Object.keys(box).forEach(key => {
              const fullPath = path ? path + box[key].delimiter + key : key;
              if (sentFolders.some(f => fullPath.includes(f) || fullPath.toUpperCase().includes('SENT'))) {
                targetFolder = fullPath;
              }
              if (box[key].children) {
                searchFolder(box[key].children, fullPath);
              }
            });
          };

          searchFolder(boxes);

          if (!targetFolder) {
            console.warn('[EMAIL SENT] Pasta Sent não encontrada, retornando vazio');
            imap.end();
            return resolve();
          }

          console.log('[EMAIL SENT] Abrindo pasta:', targetFolder);

          imap.openBox(targetFolder, false, (err, box) => {
            if (err) {
              imap.end();
              return reject(err);
            }

            console.log('[EMAIL SENT] Pasta aberta, mensagens:', box.messages.total);

            if (box.messages.total === 0) {
              imap.end();
              return resolve();
            }

            const range = box.messages.total > 20
              ? box.messages.total - 19 + ':' + box.messages.total
              : '1:*';

            const f = imap.seq.fetch(range, { bodies: '' });

            f.on('message', (msg, seqno) => {
              const chunks = [];
              msg.on('body', (stream) => {
                stream.on('data', (chunk) => chunks.push(chunk));
                stream.on('end', async () => {
                  try {
                    const buffer = Buffer.concat(chunks);
                    const parsed = await simpleParser(buffer);

                    emails.push({
                      id: seqno,
                      to: parsed.to?.text || 'Desconhecido',
                      subject: parsed.subject || '(sem assunto)',
                      date: parsed.date
                    });
                  } catch (err) {
                    console.error('[EMAIL SENT] Erro parsing:', err.message);
                  }
                });
              });
            });

            f.on('error', reject);
            f.on('end', () => {
              imap.end();
              resolve();
            });
          });
        });
      });

      imap.connect();
    });

    console.log('[EMAIL SENT] Retornando', emails.length, 'emails enviados');
    res.json({ sucesso: true, emails });
  } catch (err) {
    console.error('[EMAIL SENT] Erro:', err.message);
    res.status(400).json({
      erro: err.message || 'Erro ao buscar emails enviados'
    });
  }
});

module.exports = router;
