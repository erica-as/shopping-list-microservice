const axios = require("axios");

// Configuração
const GATEWAY_URL = "http://127.0.0.1:3000";
const API_URL = `${GATEWAY_URL}/api`;

// Estado do teste
let authToken = null;
let userId = null;
let selectedItemId = null;
let createdListId = null;

// Instância Axios configurada para IPv4
const api = axios.create({
  baseURL: API_URL,
  timeout: 5000,
  family: 4,
});

// Interceptor para adicionar Token automaticamente
api.interceptors.request.use((config) => {
  if (authToken) {
    config.headers.Authorization = `Bearer ${authToken}`;
  }
  return config;
});

// Helper de delay
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runTest() {
  console.log("=============================================");
  console.log("🚀 INICIANDO TESTE DE INTEGRAÇÃO DO SISTEMA");
  console.log("=============================================\n");

  try {
    // PASSO 1: Verificar Saúde dos Serviços
    console.log("Verificando Status do Sistema (Gateway)...");
    const healthRes = await axios.get(`${GATEWAY_URL}/health`, { family: 4 });
    console.log("   Status Gateway:", healthRes.data.status);
    console.log(
      "   Serviços Registrados:",
      Object.keys(healthRes.data.services).join(", ")
    );
    console.log("   ✅ OK\n");

    // PASSO 2: Registro e Login
    console.log("Autenticação de Usuário...");
    const uniqueUser = `user_${Date.now()}`;
    const userPayload = {
      email: `${uniqueUser}@teste.com`,
      username: uniqueUser,
      password: "password123",
      firstName: "Tester",
      lastName: "Automático",
    };

    // Registro
    console.log(`Registrando usuário: ${uniqueUser}...`);
    const registerRes = await api.post("/auth/register", userPayload);
    authToken = registerRes.data.data.token;
    userId = registerRes.data.data.user.id;
    console.log("   Usuário criado ID:", userId);
    console.log("   Token JWT obtido.");
    console.log("   ✅ OK\n");

    // PASSO 3: Catálogo de Itens
    console.log("Explorando Catálogo de Itens (Item Service)...");

    const itemsRes = await api.get("/items");
    const items = itemsRes.data.data;

    if (!items || items.length === 0) {
      throw new Error(
        "Nenhum item encontrado no catálogo. O seed do ItemService rodou?"
      );
    }

    selectedItemId = items[0].id;
    console.log(`   Itens encontrados: ${items.length}`);
    console.log(`   Item Selecionado para compra: "${items[0].name}"`);
    console.log(`   Preço: R$ ${items[0].averagePrice}`);
    console.log("   ✅ OK\n");

    // PASSO 4: Gestão de Listas
    console.log("Gerenciando Listas de Compras (List Service)...");

    // Criar Lista
    console.log("   Criando nova lista...");
    const listPayload = {
      name: "Compras da Semana",
      description: "Teste automatizado via Gateway",
    };
    const listRes = await api.post("/lists", listPayload);
    createdListId = listRes.data.data.id;
    console.log(
      `   Lista criada: "${listRes.data.data.name}" (ID: ${createdListId})`
    );

    // Adicionar Item à Lista
    console.log("   Adicionando item selecionado à lista...");
    const addItemPayload = {
      itemId: selectedItemId,
      quantity: 5,
      notes: "Marca Preferida",
    };
    const addItemRes = await api.post(
      `/lists/${createdListId}/items`,
      addItemPayload
    );
    const updatedList = addItemRes.data.data;

    const itemNaLista = updatedList.items.find(
      (i) => i.itemId === selectedItemId
    );
    console.log(
      `   Item adicionado: ${itemNaLista.itemName} x ${itemNaLista.quantity}`
    );
    console.log(
      `   Total Estimado da Lista: R$ ${updatedList.summary.estimatedTotal.toFixed(
        2
      )}`
    );
    console.log("   ✅ OK\n");

    // PASSO 5: Dashboard Agregado
    console.log("Consultando Dashboard Agregado (API Gateway)...");
    const dashRes = await api.get("/dashboard");
    const dashData = dashRes.data.data;

    console.log("   Minhas Listas (Resumo):", dashData.my_lists.count);
    console.log(
      "   Itens Recentes no Catálogo:",
      dashData.recent_items.available ? "Disponível" : "Indisponível"
    );
    console.log("   ✅ OK\n");

    // PASSO 6: Busca Global
    console.log("Testando Busca Global Unificada...");
    const searchTerm = items[0].name.split(" ")[0]; // Pega a primeira palavra do item (ex: "Produto")
    console.log(`   Buscando por termo: "${searchTerm}"...`);
    const searchRes = await api.get(`/search?q=${searchTerm}`);

    console.log(`   Resultados em Itens: ${searchRes.data.data.items.length}`);
    console.log(`   Resultados em Listas: ${searchRes.data.data.lists.length}`);
    console.log("   ✅ OK\n");

    console.log("🎉 TESTE CONCLUÍDO COM SUCESSO! O SISTEMA ESTÁ OPERACIONAL.");
    console.log("=============================================");
  } catch (error) {
    console.error("\n❌ FALHA NO TESTE:");
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Dados:`, JSON.stringify(error.response.data, null, 2));
      console.error(`   URL: ${error.config.url}`);
    } else {
      console.error(`   Erro: ${error.message}`);
    }
    process.exit(1);
  }
}

setTimeout(runTest, 2000);
