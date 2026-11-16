# CRYPTO AI EXCHANGE — Arquitectura y Documentación de Módulos

## 1. Visión General de Arquitectura
- **Frontend**: React 19 + TypeScript + Tailwind CSS v4 + TradingView Lightweight Charts v5 (`src/App.tsx`, `src/components/*`).
- **Backend**: Node.js + Express + WebSockets (`ws`) en un único servidor HTTP en puerto `3000` (`server.ts`).
- **Base de Datos**: SQLite en modo WAL (`exchange.db` vía `better-sqlite3`) con capa de repositorio modular en `server/db.ts`, fácilmente migrable a PostgreSQL manteniendo los mismos contratos de servicio.
- **Inteligencia Artificial**: SDK `@google/genai` (`gemini-4-hydrogen`) ejecutado exclusivamente en servidor (`server/aiService.ts`), integrado en un registro multi-proveedor (`ai_providers`).

## 2. Módulos Implementados (Operativos en Entorno DEMO)
1. **Autenticación, Roles y Seguridad (`server/auth.ts`, `ProfileSecurityView.tsx`)**: Registro, login, recuperación, JWT, bcrypt, 2FA por códigos temporales, gestión de sesiones, historial de actividad, KYC y roles RBAC (`USER`, `SUPPORT`, `MODERATOR`, `ADMIN`, `SUPERADMIN`).
2. **Entorno DEMO y REAL Separados (`server/db.ts`, `WalletView.tsx`)**: Saldos, wallets, órdenes, posiciones e historiales independientes. Todo usuario nuevo inicia en `DEMO` con `10.000 USDT` virtuales configurables. Retiros bloqueados en `DEMO` y sin transferencias entre entornos.
3. **Exchange Spot & Futuros 125x (`server/marketEngine.ts`, `SpotExchangeView.tsx`, `FuturesView.tsx`)**: Gráficos de velas japonesas con EMA 9/21 y Bollinger, RSI/MACD/ATR, libro de órdenes, órdenes Market/Limit/Stop Loss/Take Profit/OCO, Futuros LONG/SHORT `1x–125x` (Cross/Isolated) con cálculo automático de liquidación y cierre en tiempo real.
4. **Quick Trading (`QuickTradingView.tsx`)**: Gráfico dinámico en vivo, temporalidades `15s`, `30s`, `1m`, `3m`, `5m`, marcador de entrada, temporizador y liquidación automática en DEMO.
5. **AI Trading Bots, Señales e Inteligencia de Mercado (`BotsView.tsx`, `SignalsAndIntelView.tsx`)**: 7 tipos de bots (`Scalping`, `Trend Following`, `Grid`, `DCA`, `Arbitrage`, `AI Predictive`, `Smart Futures`), centro de señales en vivo y análisis probabilístico (`Alcista + Bajista + Lateral = 100%`).
6. **Wallet Multi-Red (`WalletView.tsx`)**: Direcciones y QR determinísticos para 9 redes (`Bitcoin`, `Ethereum`, `BNB Smart Chain`, `Polygon`, `Arbitrum`, `Optimism`, `Base`, `Tron`, `Solana`), conciliación por TXID y lista blanca de retiros.
7. **Token Factory & Launchpad (`TokenFactoryView.tsx`)**: Asistente de 10 pasos para Superadmin, Tokenomics, despliegue y verificación simulada en testnet, listado automático en el exchange y catálogo Launchpad.
8. **Comunidad, Referidos, Competencias y Academia (`CommunityAndGrowthView.tsx`)**: Chat WebSocket en 7 salas con moderación, programa de referidos antifraude, ranking DEMO en tiempo real y tutoriales guiados.
9. **Panel Superadministrador (`SuperadminView.tsx`)**: Control total de usuarios, conciliaciones, mercados, apalancamientos, proveedores IA, parámetros DEMO, módulos activos y auditoría inmutable.

## 3. Integraciones Externas que Requieren Configuración para Producción Real
- **Proveedor IA**: Configurar `GEMINI_API_KEY` en Secrets para activar síntesis con `gemini-4-hydrogen` (si falta, opera el motor cuantitativo determinístico local).
- **Custodia y Liquidación Blockchain Real**: Conectar nodos RPC / Fireblocks / custodio regulado antes de habilitar depósitos, retiros o Futuros/Quick Trading con dinero real.
- **Feed de Noticias y Liquidez Externa**: Conectar APIs de noticias financieras licenciadas y conectores de liquidez institucional (CEX/DEX) con llaves en entorno servidor.
