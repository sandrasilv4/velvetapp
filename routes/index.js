// Centralizes all router exports for use in server.js
module.exports = {
  authRouter:          require("./auth"),
  usuariosRouter:      require("./usuarios"),
  modelosRouter:       require("./modelos"),
  clientesRouter:      require("./clientes"),
  chatRouter:          require("./chat"),
  pagamentosRouter:    require("./pagamentos"),
  conteudosRouter:     require("./conteudos"),
  premiumRouter:       require("./premium"),
  ofertasRouter:       require("./ofertas"),
  verificacaoRouter:   require("./verificacao"),
  notificacoesRouter:  require("./notificacoes"),
  miscRouter:          require("./misc"),
  adminDashboardRouter: require("./adminDashboard"),
  agencyDashboardRouter: require("./agencyDashboard"),
  adminEmailRouter:    require("./adminEmail"),
  suporteRouter:       require("./suporte"),
  inboxRouter:         require("./inbox")
};
