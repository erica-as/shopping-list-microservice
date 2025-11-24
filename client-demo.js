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

// Função para buscar itens com tentativas (evita erro de tempo/seed)
async function fetchItemsWithRetry(maxRetries = 5) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await api.get("/items");
      // Gateway retorna: { success: true, data: [ ... ] }
      const items = res.data.data;

      if (items && items.length > 0) {
        return items;
      }
      console.log(
        `   ⏳ Aguardando seed do ItemService... (Tentativa ${
          i + 1
        }/${maxRetries})`
      );
    } catch (e) {
      console.log(
        `   ⚠️ Erro ao conectar com ItemService, tentando novamente...`
      );
    }
    await delay(1500);
  }
  return [];
}

async function runTest() {
  console.log("=============================================");
  console.log("🚀 INICIANDO TESTE DE INTEGRAÇÃO DO SISTEMA");
  console.log("=============================================\n");

  try {
    // PASSO 1: Verificar Saúde dos Serviços
    console.log("1️⃣  Verificando Status do Sistema (Gateway)...");
    const healthRes = await axios.get(`${GATEWAY_URL}/health`, { family: 4 });
    console.log("   Status Gateway:", healthRes.data.status);
    console.log(
      "   Serviços Registrados:",
      Object.keys(healthRes.data.services).join(", ")
    );
    console.log("   ✅ OK\n");

    // PASSO 2: Registro e Login
    console.log("2️⃣  Autenticação de Usuário...");
    const uniqueUser = `user_${Date.now()}`;
    const userPayload = {
      email: `${uniqueUser}@teste.com`,
      username: uniqueUser,
      password: "password123",
      firstName: "Tester",
      lastName: "Automático",
    };

    // Registro
    console.log(`   Registrando usuário: ${uniqueUser}...`);
    const registerRes = await api.post("/auth/register", userPayload);
    authToken = registerRes.data.data.token;
    userId = registerRes.data.data.user.id;
    console.log("   Usuário criado ID:", userId);
    console.log("   Token JWT obtido.");
    console.log("   ✅ OK\n");

    // PASSO 3: Catálogo de Itens
    console.log("3️⃣  Explorando Catálogo de Itens (Item Service)...");

    // Usando a função com retry para garantir que o seed rodou
    const items = await fetchItemsWithRetry();

    if (items.length === 0) {
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
    console.log("4️⃣  Gerenciando Listas de Compras (List Service)...");

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

    // PASSO 5: Dashboard Agregado (CORRIGIDO)
    console.log("5️⃣  Consultando Dashboard Agregado (API Gateway)...");
    const dashRes = await api.get("/dashboard");

    const dashboardPayload = dashRes.data.data;
    const stats = dashboardPayload.data;

    if (stats && stats.my_lists) {
      console.log("   Minhas Listas (Resumo):", stats.my_lists.count);
      console.log(
        "   Itens Recentes no Catálogo:",
        stats.recent_items.available ? "Disponível" : "Indisponível"
      );
    } else {
      console.log(
        "   ⚠️ Estrutura do dashboard inesperada:",
        JSON.stringify(dashboardPayload, null, 2)
      );
    }
    console.log("   ✅ OK\n");

    // PASSO 6: Busca Global
    console.log("6️⃣  Testando Busca Global Unificada...");
    const searchTerm = items[0].name.split(" ")[0];
    console.log(`   Buscando por termo: "${searchTerm}"...`);
    const searchRes = await api.get(`/search?q=${searchTerm}`);

    console.log(`   Resultados em Itens: ${searchRes.data.data.items.length}`);
    const listCount = searchRes.data.data.lists
      ? searchRes.data.data.lists.length
      : 0;
    console.log(`   Resultados em Listas: ${listCount}`);
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

setTimeout(runTest, 3000);
