const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configurações do Infinity Pay
const INFINITY_PAY_CONFIG = {
  handle: process.env.INFINITY_HANDLE, // Sua InfiniteTag (sem $)
  baseUrl: 'https://api.infinitepay.io',
  checkoutBaseUrl: 'https://checkout.infinitepay.io',
  webhookSecret: process.env.WEBHOOK_SECRET || 'sua_chave_secreta'
};

// Configuração do ESP32
const ESP32_CONFIG = {
  ip: process.env.ESP32_IP || '192.168.4.1',
  port: process.env.ESP32_PORT || '80'
};

// Base de dados em memória (em produção, use um banco real)
const pagamentos = new Map();
const maquinas = new Map();

// Programas de lavagem de carros
const programas = {
  1: { nome: 'Lavagem Simples', duracao: 15, preco: 1500 },   // R$ 15,00 em centavos
  2: { nome: 'Lavagem Completa', duracao: 25, preco: 2500 },  // R$ 25,00 em centavos
  3: { nome: 'Lavagem Premium', duracao: 35, preco: 4000 },   // R$ 40,00 em centavos
  4: { nome: 'Lavagem VIP', duracao: 45, preco: 5500 }        // R$ 55,00 em centavos
};

// Função para gerar ID único
function gerarId() {
  return crypto.randomBytes(16).toString('hex');
}

// Endpoint para criar checkout completo (cartão + Pix)
app.post('/api/payment/create-checkout', async (req, res) => {
  try {
    const { 
      programaId, 
      customer, 
      payment_config,
      maquinaId = '001' 
    } = req.body;
    
    if (!programas[programaId]) {
      return res.status(400).json({ error: 'Programa inválido' });
    }
    
    const programa = programas[programaId];
    const orderId = gerarId();
    
    // Calcular preço com desconto (se débito)
    let finalPrice = programa.preco;
    if (payment_config?.enable_discount && payment_config?.discount_amount) {
      finalPrice = programa.preco - payment_config.discount_amount;
    }

    // Dados para o Infinity Pay - Checkout Completo
    const checkoutData = {
      handle: INFINITY_PAY_CONFIG.handle,
      redirect_url: `${req.protocol}://${req.get('host')}/success?order=${orderId}`,
      webhook_url: `${req.protocol}://${req.get('host')}/api/webhook/payment`,
      order_nsu: orderId,
      items: [{
        quantity: 1,
        price: finalPrice,
        description: `${programa.nome} - Lavagem de Carro`
      }],
      customer: {
        name: customer.name,
        email: customer.email || `${customer.phone_number}@temp.com`,
        phone_number: customer.phone_number
      },
      // Configurações específicas de pagamento
      payment_settings: {
        // Habilitar todos os métodos de pagamento
        enable_credit_card: true,
        enable_debit_card: true,
        enable_pix: true,
        
        // Configurações do cartão de crédito
        credit_card_settings: {
          max_installments: 12,
          min_installment_amount: 500, // R$ 5,00 mínimo por parcela
          interest_free_installments: 3, // Até 3x sem juros
          interest_rate: 2.5 // 2.5% ao mês após 3x
        },
        
        // Configurações do PIX
        pix_settings: {
          expires_in: 3600, // 1 hora para expirar
          enable_discount: payment_config?.enable_discount || false,
          discount_type: 'percentage',
          discount_value: payment_config?.enable_discount ? 5 : 0 // 5% desconto no PIX
        },
        
        // Configurações do débito
        debit_card_settings: {
          enable_discount: payment_config?.enable_discount || false,
          discount_type: 'percentage', 
          discount_value: payment_config?.enable_discount ? 5 : 0 // 5% desconto no débito
        }
      }
    };

    console.log('📤 Enviando dados para Infinity Pay:', JSON.stringify(checkoutData, null, 2));

    // Criar checkout no Infinity Pay
    const response = await axios.post(
      `${INFINITY_PAY_CONFIG.baseUrl}/invoices/public/checkout/links`,
      checkoutData,
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    console.log('📥 Resposta do Infinity Pay:', response.data);

    if (response.data && (response.data.checkout_url || response.data.payment_url)) {
      const checkoutUrl = response.data.checkout_url || response.data.payment_url;
      
      // Salvar dados do pagamento
      pagamentos.set(orderId, {
        id: orderId,
        programaId,
        maquinaId,
        programa: programa.nome,
        preco: finalPrice,
        precoOriginal: programa.preco,
        customer,
        status: 'pending',
        checkoutUrl,
        paymentMethods: payment_config?.accepted_payment_types || ['credit_card', 'debit_card', 'pix'],
        criadoEm: new Date().toISOString()
      });
      
      res.json({
        success: true,
        orderId,
        checkout_url: checkoutUrl,
        programa: programa.nome,
        preco: finalPrice,
        precoOriginal: programa.preco,
        desconto: programa.preco - finalPrice
      });
      
    } else {
      throw new Error('Resposta inválida do Infinity Pay');
    }
    
  } catch (error) {
    console.error('❌ Erro ao criar checkout:', error.message);
    console.error('Detalhes:', error.response?.data);
    
    res.status(500).json({ 
      success: false,
      error: 'Erro interno do servidor',
      message: error.message,
      details: error.response?.data || 'Erro desconhecido'
    });
  }
});

// Criar checkout via URL direta (alternativo)
app.post('/api/payment/create-url-checkout', async (req, res) => {
  try {
    const { programaId, customer, paymentMethod, maquinaId = '001' } = req.body;
    
    if (!programas[programaId]) {
      return res.status(400).json({ error: 'Programa inválido' });
    }
    
    const programa = programas[programaId];
    const orderId = gerarId();
    
    // Calcular desconto se for débito ou PIX
    let finalPrice = programa.preco;
    let discount = 0;
    if (paymentMethod === 'debit_card' || paymentMethod === 'pix') {
      discount = Math.floor(programa.preco * 0.05); // 5% desconto
      finalPrice = programa.preco - discount;
    }

    // Construir URL de checkout direto
    const checkoutParams = new URLSearchParams({
      handle: INFINITY_PAY_CONFIG.handle,
      items: JSON.stringify([{
        name: `${programa.nome} - Lavagem de Carro`,
        amount: finalPrice,
        quantity: 1
      }]),
      order_nsu: orderId,
      redirect_url: `${req.protocol}://${req.get('host')}/success?order=${orderId}`,
      customer_name: customer.name,
      customer_email: customer.email || `${customer.phone_number}@temp.com`,
      customer_cellphone: customer.phone_number,
      webhook_url: `${req.protocol}://${req.get('host')}/api/webhook/payment`
    });

    const checkoutUrl = `${INFINITY_PAY_CONFIG.checkoutBaseUrl}/${INFINITY_PAY_CONFIG.handle}?${checkoutParams.toString()}`;
    
    // Salvar dados do pagamento
    pagamentos.set(orderId, {
      id: orderId,
      programaId,
      maquinaId,
      programa: programa.nome,
      preco: finalPrice,
      precoOriginal: programa.preco,
      desconto: discount,
      customer,
      paymentMethod,
      status: 'pending',
      checkoutUrl,
      criadoEm: new Date().toISOString()
    });
    
    res.json({
      success: true,
      orderId,
      checkout_url: checkoutUrl,
      programa: programa.nome,
      preco: finalPrice,
      desconto: discount
    });
    
  } catch (error) {
    console.error('❌ Erro ao criar URL checkout:', error.message);
    res.status(500).json({ 
      success: false,
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

// Webhook do Infinity Pay para receber confirmações de pagamento
app.post('/api/webhook/payment', async (req, res) => {
  try {
    console.log('🔔 Webhook recebido do Infinity Pay:', req.body);
    
    const { 
      order_nsu, 
      paid, 
      amount, 
      transaction_nsu, 
      capture_method,
      installments,
      invoice_slug 
    } = req.body;
    
    if (!order_nsu) {
      console.log('❌ order_nsu não fornecido no webhook');
      return res.status(400).json({ error: 'order_nsu não fornecido' });
    }
    
    const pagamento = pagamentos.get(order_nsu);
    if (!pagamento) {
      console.log('❌ Pagamento não encontrado:', order_nsu);
      return res.status(404).json({ error: 'Pagamento não encontrado' });
    }
    
    if (paid) {
      // Pagamento aprovado
      pagamento.status = 'paid';
      pagamento.transactionNsu = transaction_nsu;
      pagamento.captureMethod = capture_method; // 'credit_card', 'debit_card' ou 'pix'
      pagamento.installments = installments || 1;
      pagamento.invoiceSlug = invoice_slug;
      pagamento.pagoEm = new Date().toISOString();
      
      console.log(`✅ Pagamento aprovado via ${capture_method}:`, order_nsu);
      
      // Liberar máquina automaticamente
      const liberacaoResult = await liberarMaquina(pagamento.maquinaId, pagamento.programaId, pagamento);
      
      if (liberacaoResult.success) {
        pagamento.maquinaLiberada = true;
        pagamento.liberadaEm = new Date().toISOString();
        console.log(`🚗 Máquina ${pagamento.maquinaId} liberada com sucesso!`);
      } else {
        pagamento.maquinaLiberada = false;
        pagamento.erroLiberacao = liberacaoResult.error;
        console.log(`❌ Erro ao liberar máquina:`, liberacaoResult.error);
      }
      
      pagamentos.set(order_nsu, pagamento);
      res.status(200).json({ status: 'processed', message: 'Pagamento processado com sucesso' });
      
    } else {
      // Pagamento recusado ou cancelado
      pagamento.status = 'failed';
      pagamento.failReason = req.body.fail_reason || 'Pagamento recusado';
      pagamentos.set(order_nsu, pagamento);
      
      console.log(`❌ Pagamento recusado:`, order_nsu);
      res.status(200).json({ status: 'processed', message: 'Pagamento recusado processado' });
    }
    
  } catch (error) {
    console.error('❌ Erro no webhook:', error);
    res.status(500).json({ error: 'Erro interno no webhook' });
  }
});

// Função para liberar máquina via ESP32
async function liberarMaquina(maquinaId, programaId, pagamento) {
  try {
    const esp32Url = `http://${ESP32_CONFIG.ip}:${ESP32_CONFIG.port}/api/machine/start`;
    
    const comandoData = {
      program: programaId,
      machine: maquinaId,
      customer: pagamento.customer.name,
      payment_method: pagamento.captureMethod,
      order_id: pagamento.id,
      duration_minutes: programas[programaId].duracao
    };

    console.log(`📤 Enviando comando para ESP32 (${esp32Url}):`, comandoData);
    
    const response = await axios.post(esp32Url, comandoData, {
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (response.status === 200) {
      // Registrar máquina como ativa
      maquinas.set(maquinaId, {
        id: maquinaId,
        status: 'running',
        programa: programaId,
        customer: pagamento.customer.name,
        orderId: pagamento.id,
        iniciadaEm: new Date().toISOString(),
        previsaoTermino: new Date(Date.now() + (programas[programaId].duracao * 60000)).toISOString()
      });
      
      return { success: true, data: response.data };
    } else {
      return { success: false, error: 'Resposta inválida do ESP32' };
    }
    
  } catch (error) {
    console.error('❌ Erro ao comunicar com ESP32:', error.message);
    return { success: false, error: error.message };
  }
}

// Endpoint para verificar status do pagamento
app.get('/api/payment/status/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const pagamento = pagamentos.get(orderId);
    
    if (!pagamento) {
      return res.status(404).json({ error: 'Pagamento não encontrado' });
    }

    // Se ainda está pendente, verificar status no Infinity Pay
    if (pagamento.status === 'pending') {
      try {
        const checkResponse = await axios.post(
          `${INFINITY_PAY_CONFIG.baseUrl}/invoices/public/checkout/payment_check`,
          {
            handle: INFINITY_PAY_CONFIG.handle,
            order_nsu: orderId,
            transaction_nsu: pagamento.transactionNsu,
            slug: pagamento.invoiceSlug
          },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 5000
          }
        );

        if (checkResponse.data && checkResponse.data.paid) {
          pagamento.status = 'paid';
          pagamento.captureMethod = checkResponse.data.capture_method;
          pagamento.installments = checkResponse.data.installments;
          pagamento.pagoEm = new Date().toISOString();
          pagamentos.set(orderId, pagamento);
        }
      } catch (error) {
        console.error('Erro ao verificar status no Infinity Pay:', error.message);
      }
    }
    
    res.json(pagamento);
    
  } catch (error) {
    console.error('Erro ao verificar status:', error.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Endpoint para verificar status da máquina
app.get('/api/machine/status/:maquinaId?', async (req, res) => {
  try {
    const { maquinaId = '001' } = req.params;
    
    // Consultar ESP32
    const esp32Url = `http://${ESP32_CONFIG.ip}:${ESP32_CONFIG.port}/api/status`;
    const response = await axios.get(esp32Url, { timeout: 5000 });
    
    res.json({
      maquinaId,
      esp32Status: response.data,
      localStatus: maquinas.get(maquinaId) || { status: 'idle' }
    });
    
  } catch (error) {
    console.error('Erro ao consultar ESP32:', error.message);
    res.status(500).json({ 
      error: 'Erro ao consultar máquina',
      details: error.message 
    });
  }
});

// Endpoint para iniciar máquina manualmente
app.post('/api/machine/start', async (req, res) => {
  try {
    const { program, customer, duration, machine = '001' } = req.body;
    
    const resultado = await liberarMaquina(machine, program, { 
      customer: { name: customer },
      captureMethod: 'manual',
      id: 'manual_' + Date.now()
    });
    
    if (resultado.success) {
      res.json({ success: true, message: 'Máquina iniciada com sucesso' });
    } else {
      res.status(500).json({ success: false, error: resultado.error });
    }
    
  } catch (error) {
    console.error('Erro ao iniciar máquina:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint de emergência
app.post('/api/machine/emergency/:maquinaId?', async (req, res) => {
  try {
    const { maquinaId = '001' } = req.params;
    
    // Parada de emergência no ESP32
    const esp32Url = `http://${ESP32_CONFIG.ip}:${ESP32_CONFIG.port}/emergency`;
    await axios.post(esp32Url, {}, { timeout: 5000 });
    
    // Atualizar status local
    maquinas.set(maquinaId, {
      id: maquinaId,
      status: 'emergency_stop',
      paradaEm: new Date().toISOString()
    });
    
    console.log(`🚨 Parada de emergência ativada na máquina ${maquinaId}`);
    res.json({ success: true, message: 'Parada de emergência ativada' });
    
  } catch (error) {
    console.error('Erro na parada de emergência:', error.message);
    res.status(500).json({ 
      error: 'Erro na parada de emergência',
      details: error.message 
    });
  }
});

// Página de sucesso após pagamento
app.get('/success', (req, res) => {
  const { order } = req.query;
  const pagamento = pagamentos.get(order);
  
  if (pagamento) {
    const metodoPagamento = {
      'credit_card': 'Cartão de Crédito',
      'debit_card': 'Cartão de Débito', 
      'pix': 'Pix'
    };

    res.send(`
      <html>
        <head>
          <title>🚗 Pagamento Aprovado - CarWash Pro</title>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { 
              font-family: Arial; 
              text-align: center; 
              padding: 50px; 
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              margin: 0;
              min-height: 100vh;
            }
            .container {
              background: rgba(255,255,255,0.1);
              padding: 40px;
              border-radius: 20px;
              backdrop-filter: blur(10px);
              max-width: 500px;
              margin: 0 auto;
            }
            h1 { font-size: 2.5em; margin-bottom: 20px; }
            .info { background: rgba(255,255,255,0.2); padding: 20px; border-radius: 15px; margin: 20px 0; }
            .price { font-size: 2em; font-weight: bold; color: #4CAF50; }
            .status { padding: 15px; border-radius: 10px; margin: 20px 0; }
            .success { background: rgba(76, 175, 80, 0.3); border: 2px solid #4CAF50; }
            .pending { background: rgba(255, 193, 7, 0.3); border: 2px solid #FFC107; }
            button {
              background: #4CAF50;
              color: white;
              border: none;
              padding: 15px 30px;
              font-size: 18px;
              border-radius: 10px;
              cursor: pointer;
              margin: 10px;
            }
            button:hover { background: #45a049; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🎉 Pagamento Aprovado!</h1>
            
            <div class="info">
              <h3>🚗 ${pagamento.programa}</h3>
              <p><strong>Cliente:</strong> ${pagamento.customer.name}</p>
              <p class="price">R$ ${(pagamento.preco / 100).toFixed(2)}</p>
              ${pagamento.desconto ? `<p style="color: #4CAF50;">💰 Desconto: R$ ${(pagamento.desconto / 100).toFixed(2)}</p>` : ''}
              <p><strong>Forma de pagamento:</strong> ${metodoPagamento[pagamento.captureMethod] || pagamento.captureMethod || 'N/A'}</p>
              ${pagamento.installments > 1 ? `<p><strong>Parcelas:</strong> ${pagamento.installments}x</p>` : ''}
            </div>

            <div class="status ${pagamento.maquinaLiberada ? 'success' : 'pending'}">
              ${pagamento.maquinaLiberada ? 
                '🟢 <strong>Máquina liberada!</strong><br>Sua lavagem pode ser iniciada.' : 
                '🟡 <strong>Aguardando liberação...</strong><br>A máquina será liberada em instantes.'
              }
            </div>

            <button onclick="window.close()">Fechar</button>
            <button onclick="window.location.href='/'">Nova Lavagem</button>
            
            <script>
              // Auto-refresh para verificar se máquina foi liberada
              if (${!pagamento.maquinaLiberada}) {
                setTimeout(() => window.location.reload(), 3000);
              }
            </script>
          </div>
        </body>
      </html>
    `);
  } else {
    res.status(404).send(`
      <html>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h1>❌ Pagamento não encontrado</h1>
          <button onclick="window.location.href='/'">Voltar ao Início</button>
        </body>
      </html>
    `);
  }
});

// Endpoint para listar todos os pagamentos (para debug/admin)
app.get('/api/admin/payments', (req, res) => {
  const allPayments = Array.from(pagamentos.values()).map(p => ({
    ...p,
    // Ocultar dados sensíveis em produção
    customer: { 
      name: p.customer?.name,
      phone: p.customer?.phone_number?.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-****')
    }
  }));
  
  res.json({
    total: allPayments.length,
    payments: allPayments.sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm))
  });
});

// Endpoint para listar máquinas ativas
app.get('/api/admin/machines', (req, res) => {
  const allMachines = Array.from(maquinas.values());
  res.json(allMachines);
});

// Servir página inicial
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>🚗 CarWash Pro - Sistema de Pagamento</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
      </head>
      <body style="font-family: Arial; text-align: center; padding: 50px;">
        <h1>🚗 CarWash Pro</h1>
        <p>Sistema de Lavagem de Carros com Infinity Pay</p>
        <p><strong>Backend rodando!</strong></p>
        <ul style="text-align: left; max-width: 400px; margin: 0 auto;">
          <li>✅ Infinity Pay integrado (Cartão + Pix)</li>
          <li>✅ ESP32 configurado</li>
          <li>✅ Webhooks ativos</li>
          <li>✅ Sistema completo funcionando</li>
        </ul>
        <br>
        <p><a href="/api/admin/payments">📊 Ver Pagamentos</a></p>
        <p><a href="/api/admin/machines">🚗 Ver Máquinas</a></p>
      </body>
    </html>
  `);
});

// Middleware de erro
app.use((error, req, res, next) => {
  console.error('❌ Erro não tratado:', error);
  res.status(500).json({ 
    error: 'Erro interno do servidor',
    message: error.message,
    timestamp: new Date().toISOString()
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor CarWash Pro rodando na porta ${PORT}`);
  console.log(`🔧 ESP32 configurado para: ${ESP32_CONFIG.ip}:${ESP32_CONFIG.port}`);
  console.log(`💳 Infinity Pay Handle: ${INFINITY_PAY_CONFIG.handle}`);
  console.log(`🎯 Checkout URL: http://localhost:${PORT}`);
  console.log(`📊 Admin Payments: http://localhost:${PORT}/api/admin/payments`);
  
  // Log de configuração
  console.log('\n📋 Configuração:');
  console.log(`   - Programas disponíveis: ${Object.keys(programas).length}`);
  console.log(`   - Métodos de pagamento: Cartão (débito/crédito) + Pix`);
  console.log(`   - Desconto débito/Pix: 5%`);
  console.log(`   - Parcelamento: até 12x`);
  console.log(`   - Webhooks: Ativados`);
  console.log('');
});

module.exports = app;