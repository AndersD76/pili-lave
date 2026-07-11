import React, { useState } from 'react';
import { Play, Lock, Unlock, CreditCard, CheckCircle, AlertCircle, Car, Smartphone } from 'lucide-react';

const CarWashApp = () => {
  const [selectedWash, setSelectedWash] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState(null);
  const [paymentStatus, setPaymentStatus] = useState('idle');
  const [machineStatus, setMachineStatus] = useState('locked');
  const [currentStep, setCurrentStep] = useState('selection');
  const [customerInfo, setCustomerInfo] = useState({ name: '', phone: '', email: '' });

  const washPrograms = [
    { 
      id: 1, 
      name: 'Lavagem Simples', 
      duration: '15 min', 
      price: 'R$ 15,00',
      priceValue: 1500, // em centavos
      description: 'Água e sabão básico',
      icon: '🚗',
      features: ['Água pressurizada', 'Sabão neutro', 'Enxágue final']
    },
    { 
      id: 2, 
      name: 'Lavagem Completa', 
      duration: '25 min', 
      price: 'R$ 25,00',
      priceValue: 2500,
      description: 'Água, sabão e cera',
      icon: '✨',
      features: ['Pré-lavagem', 'Sabão premium', 'Cera líquida', 'Secagem']
    },
    { 
      id: 3, 
      name: 'Lavagem Premium', 
      duration: '35 min', 
      price: 'R$ 40,00',
      priceValue: 4000,
      description: 'Completa + aspirador + pneus',
      icon: '🏆',
      features: ['Lavagem completa', 'Aspiração interna', 'Pretinho nos pneus', 'Limpeza rodas']
    },
    { 
      id: 4, 
      name: 'Lavagem VIP', 
      duration: '45 min', 
      price: 'R$ 55,00',
      priceValue: 5500,
      description: 'Premium + enceramento + perfume',
      icon: '💎',
      features: ['Serviço premium', 'Cera especial', 'Perfume automotivo', 'Pano microfibra', 'Proteção UV']
    }
  ];

  const paymentMethods = [
    {
      id: 'credit_card',
      name: 'Cartão de Crédito',
      description: 'Parcelamento em até 12x',
      icon: <CreditCard className="text-blue-600" size={32} />,
      color: 'border-blue-500 bg-blue-50'
    },
    {
      id: 'debit_card', 
      name: 'Cartão de Débito',
      description: 'Desconto à vista',
      icon: <CreditCard className="text-green-600" size={32} />,
      color: 'border-green-500 bg-green-50'
    },
    {
      id: 'pix',
      name: 'Pix',
      description: 'Instantâneo e seguro',
      icon: <Smartphone className="text-purple-600" size={32} />,
      color: 'border-purple-500 bg-purple-50'
    }
  ];

  const handleWashSelection = (program) => {
    setSelectedWash(program);
  };

  const handlePaymentMethodSelection = (method) => {
    setPaymentMethod(method);
  };

  const proceedToPayment = () => {
    if (!selectedWash) {
      alert('Selecione um programa de lavagem primeiro!');
      return;
    }
    setCurrentStep('payment_method');
  };

  const proceedToCheckout = () => {
    if (!paymentMethod) {
      alert('Selecione um método de pagamento!');
      return;
    }
    setCurrentStep('customer_info');
  };

  const processPayment = async () => {
    if (!customerInfo.name || !customerInfo.phone) {
      alert('Preencha pelo menos nome e telefone!');
      return;
    }

    setCurrentStep('payment');
    setPaymentStatus('processing');
    
    try {
      // Criar link de pagamento via API do Infinity Pay
      const orderNsu = Date.now().toString();
      
      const paymentData = {
        handle: "sua_infinite_tag", // Substituir pela sua InfiniteTag
        redirect_url: `${window.location.origin}/success?order=${orderNsu}`,
        webhook_url: `${window.location.origin}/api/webhook/payment`,
        order_nsu: orderNsu,
        items: [{
          quantity: 1,
          price: selectedWash.priceValue, // Preço em centavos
          description: `${selectedWash.name} - ${selectedWash.description}`
        }],
        customer: {
          name: customerInfo.name,
          email: customerInfo.email || `${customerInfo.phone}@temp.com`,
          phone_number: customerInfo.phone
        },
        payment_config: {
          fine_amount: 0,
          interest_amount: 0,
          enable_discount: paymentMethod.id === 'debit_card',
          discount_amount: paymentMethod.id === 'debit_card' ? Math.floor(selectedWash.priceValue * 0.05) : 0, // 5% desconto no débito
          accepted_payment_types: getAcceptedPaymentTypes()
        }
      };

      // Fazer requisição para criar checkout
      const response = await fetch('/api/payment/create-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(paymentData)
      });

      const result = await response.json();
      
      if (result.success && result.checkout_url) {
        // Redirecionar para checkout do Infinity Pay
        window.location.href = result.checkout_url;
      } else {
        throw new Error(result.message || 'Erro ao criar checkout');
      }
      
    } catch (error) {
      console.error('Erro no pagamento:', error);
      setPaymentStatus('error');
    }
  };

  const getAcceptedPaymentTypes = () => {
    switch (paymentMethod?.id) {
      case 'credit_card':
        return ['credit_card'];
      case 'debit_card':
        return ['debit_card'];
      case 'pix':
        return ['pix'];
      default:
        return ['credit_card', 'debit_card', 'pix'];
    }
  };

  const startMachine = async () => {
    setMachineStatus('running');
    
    try {
      // Enviar comando para ESP32
      const response = await fetch('/api/machine/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          program: selectedWash.id,
          duration: selectedWash.duration,
          customer: customerInfo.name
        })
      });

      if (response.ok) {
        alert(`🚗 Lavagem iniciada! ${selectedWash.name} - ${selectedWash.duration}`);
        
        // Simular duração da lavagem
        const durationMs = parseInt(selectedWash.duration) * 60000; // converter minutos para ms
        setTimeout(() => {
          setMachineStatus('completed');
          alert('🎉 Lavagem concluída! Seu carro está pronto!');
        }, Math.min(durationMs, 10000)); // Max 10s para demonstração
        
      } else {
        alert('❌ Erro ao comunicar com a máquina');
      }
      
    } catch (error) {
      console.error('Erro ao conectar com ESP32:', error);
      alert('❌ Erro de conexão com a máquina');
    }
  };

  const resetApp = () => {
    setSelectedWash(null);
    setPaymentMethod(null);
    setPaymentStatus('idle');
    setMachineStatus('locked');
    setCurrentStep('selection');
    setCustomerInfo({ name: '', phone: '', email: '' });
  };

  // Tela de seleção de programas
  if (currentStep === 'selection') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-cyan-100 p-4 md:p-8">
        <div className="max-w-6xl mx-auto">
          <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
            <div className="text-center mb-8">
              <h1 className="text-4xl md:text-6xl font-bold text-gray-800 mb-2">
                🚗 CarWash Pro
              </h1>
              <p className="text-gray-600 text-lg md:text-xl">
                Escolha seu programa de lavagem
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              {washPrograms.map((program) => (
                <div
                  key={program.id}
                  onClick={() => handleWashSelection(program)}
                  className={`p-6 rounded-2xl border-3 cursor-pointer transition-all duration-300 ${
                    selectedWash?.id === program.id
                      ? 'border-blue-500 bg-blue-50 shadow-lg scale-105'
                      : 'border-gray-200 hover:border-gray-300 hover:shadow-md hover:scale-102'
                  }`}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center">
                      <span className="text-4xl mr-3">{program.icon}</span>
                      <div>
                        <h3 className="text-xl font-bold text-gray-800">{program.name}</h3>
                        <p className="text-gray-600">{program.description}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-3xl font-bold text-blue-600">{program.price}</span>
                      <p className="text-sm text-gray-500">{program.duration}</p>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <p className="font-semibold text-gray-700 mb-2">Incluído:</p>
                    <div className="grid grid-cols-2 gap-1">
                      {program.features.map((feature, index) => (
                        <div key={index} className="flex items-center text-sm text-gray-600">
                          <CheckCircle className="text-green-500 mr-1" size={16} />
                          {feature}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {selectedWash && (
              <div className="text-center">
                <button
                  onClick={proceedToPayment}
                  className="bg-blue-600 text-white px-8 py-4 rounded-xl font-semibold text-xl hover:bg-blue-700 transition-colors duration-200 shadow-lg"
                >
                  Prosseguir para Pagamento → {selectedWash.price}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Tela de seleção de método de pagamento
  if (currentStep === 'payment_method') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-cyan-100 p-4 md:p-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-gray-800 mb-2">💳 Forma de Pagamento</h2>
              <p className="text-gray-600">Como você gostaria de pagar?</p>
              
              <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                <p className="font-semibold">{selectedWash.name}</p>
                <p className="text-2xl font-bold text-blue-600">{selectedWash.price}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              {paymentMethods.map((method) => (
                <div
                  key={method.id}
                  onClick={() => handlePaymentMethodSelection(method)}
                  className={`p-6 rounded-2xl border-2 cursor-pointer transition-all duration-200 ${
                    paymentMethod?.id === method.id
                      ? method.color
                      : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
                  }`}
                >
                  <div className="text-center">
                    <div className="mb-4">{method.icon}</div>
                    <h3 className="font-bold text-lg mb-2">{method.name}</h3>
                    <p className="text-sm text-gray-600">{method.description}</p>
                    
                    {method.id === 'debit_card' && (
                      <div className="mt-3 p-2 bg-green-100 rounded-lg">
                        <p className="text-xs text-green-700 font-semibold">
                          5% de desconto!
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setCurrentStep('selection')}
                className="flex-1 bg-gray-500 text-white py-4 rounded-xl font-semibold hover:bg-gray-600 transition-colors"
              >
                ← Voltar
              </button>
              
              {paymentMethod && (
                <button
                  onClick={proceedToCheckout}
                  className="flex-1 bg-blue-600 text-white py-4 rounded-xl font-semibold hover:bg-blue-700 transition-colors"
                >
                  Continuar →
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Tela de informações do cliente
  if (currentStep === 'customer_info') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-cyan-100 p-4 md:p-8">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-gray-800 mb-2">📋 Seus Dados</h2>
              <p className="text-gray-600">Para finalizar o pagamento</p>
            </div>

            <div className="space-y-6 mb-8">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Nome Completo *
                </label>
                <input
                  type="text"
                  value={customerInfo.name}
                  onChange={(e) => setCustomerInfo({...customerInfo, name: e.target.value})}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-lg"
                  placeholder="Digite seu nome completo"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Telefone *
                </label>
                <input
                  type="tel"
                  value={customerInfo.phone}
                  onChange={(e) => setCustomerInfo({...customerInfo, phone: e.target.value})}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-lg"
                  placeholder="(11) 99999-9999"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  E-mail (opcional)
                </label>
                <input
                  type="email"
                  value={customerInfo.email}
                  onChange={(e) => setCustomerInfo({...customerInfo, email: e.target.value})}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-lg"
                  placeholder="seu@email.com"
                />
              </div>
            </div>

            {/* Resumo do pedido */}
            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <h3 className="font-bold text-gray-800 mb-2">📄 Resumo do Pedido</h3>
              <div className="flex justify-between items-center mb-2">
                <span>{selectedWash.name}</span>
                <span>{selectedWash.price}</span>
              </div>
              <div className="flex justify-between items-center mb-2">
                <span>Forma de pagamento:</span>
                <span className="font-semibold">{paymentMethod.name}</span>
              </div>
              {paymentMethod.id === 'debit_card' && (
                <>
                  <div className="flex justify-between items-center text-green-600">
                    <span>Desconto (5%):</span>
                    <span>-R$ {(selectedWash.priceValue * 0.05 / 100).toFixed(2)}</span>
                  </div>
                  <hr className="my-2" />
                  <div className="flex justify-between items-center font-bold">
                    <span>Total:</span>
                    <span>R$ {(selectedWash.priceValue * 0.95 / 100).toFixed(2)}</span>
                  </div>
                </>
              )}
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setCurrentStep('payment_method')}
                className="flex-1 bg-gray-500 text-white py-4 rounded-xl font-semibold hover:bg-gray-600 transition-colors"
              >
                ← Voltar
              </button>
              
              <button
                onClick={processPayment}
                disabled={!customerInfo.name || !customerInfo.phone}
                className="flex-2 bg-green-600 text-white py-4 px-8 rounded-xl font-semibold hover:bg-green-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                💳 Finalizar Pagamento
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Tela de processamento de pagamento
  if (currentStep === 'payment') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-cyan-100 p-4 flex items-center justify-center">
        <div className="max-w-md mx-auto">
          <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-800 mb-2">Processando Pagamento</h2>
              <p className="text-gray-600">Redirecionando para Infinity Pay...</p>
            </div>

            <div className="mb-6">
              <div className="bg-gray-50 rounded-xl p-4 mb-4">
                <h3 className="font-semibold text-gray-800">{selectedWash.name}</h3>
                <p className="text-sm text-gray-600 mb-2">{customerInfo.name}</p>
                <p className="text-2xl font-bold text-blue-600">{selectedWash.price}</p>
                <p className="text-sm text-gray-500">{paymentMethod.name}</p>
              </div>
            </div>

            {paymentStatus === 'processing' && (
              <div className="flex flex-col items-center space-y-4">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                <p className="text-gray-600">Preparando checkout seguro...</p>
              </div>
            )}

            {paymentStatus === 'error' && (
              <div className="flex flex-col items-center space-y-4">
                <AlertCircle className="text-red-500" size={48} />
                <p className="text-red-600 font-semibold">Erro ao processar pagamento</p>
                <button
                  onClick={resetApp}
                  className="bg-gray-500 text-white px-6 py-2 rounded-lg hover:bg-gray-600 transition-colors"
                >
                  Tentar novamente
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Tela de sucesso (caso o usuário retorne)
  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-green-100 p-4 flex items-center justify-center">
      <div className="max-w-md mx-auto">
        <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className="mb-6">
            <CheckCircle className="text-green-500 mx-auto mb-4" size={64} />
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Pagamento Aprovado!</h2>
            <p className="text-gray-600">Sua lavagem será iniciada</p>
          </div>

          <div className="bg-green-50 rounded-xl p-4 mb-6">
            <h3 className="font-semibold text-gray-800 mb-2">{selectedWash?.name}</h3>
            <p className="text-gray-600">Duração: {selectedWash?.duration}</p>
            <div className="flex items-center justify-center space-x-2 mt-3">
              <Car className="text-green-600" size={20} />
              <span className="text-green-600 font-semibold">Máquina Liberada</span>
            </div>
          </div>

          <button
            onClick={startMachine}
            className="w-full bg-green-600 text-white py-4 rounded-xl font-semibold text-lg hover:bg-green-700 transition-colors duration-200 flex items-center justify-center space-x-2 mb-4"
          >
            <Play size={24} />
            <span>🚗 Iniciar Lavagem</span>
          </button>

          <button
            onClick={resetApp}
            className="w-full bg-gray-500 text-white py-3 rounded-xl font-semibold hover:bg-gray-600 transition-colors duration-200"
          >
            Nova Lavagem
          </button>
        </div>
      </div>
    </div>
  );
};

export default CarWashApp;