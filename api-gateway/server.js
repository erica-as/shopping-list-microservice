const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const axios = require("axios");

// Importar service registry
const serviceRegistry = require("../shared/serviceRegistry");

class APIGateway {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3000;

    // Circuit breaker simples
    this.circuitBreakers = new Map();

    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
    setTimeout(() => {
      this.startHealthChecks();
    }, 3000);
  }

  setupMiddleware() {
    this.app.use(helmet());
    this.app.use(cors());
    this.app.use(morgan("combined"));
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Gateway headers
    this.app.use((req, res, next) => {
      res.setHeader("X-Gateway", "api-gateway");
      res.setHeader("X-Gateway-Version", "1.0.0");
      res.setHeader("X-Architecture", "Microservices-NoSQL");
      next();
    });

    // Request logging
    this.app.use((req, res, next) => {
      console.log(`${req.method} ${req.originalUrl} - ${req.ip}`);
      next();
    });
  }

  setupRoutes() {
    // Gateway health check
    this.app.get("/health", (req, res) => {
      const services = serviceRegistry.listServices();
      res.json({
        service: "api-gateway",
        status: "healthy",
        timestamp: new Date().toISOString(),
        architecture: "Microservices with NoSQL",
        services: services,
        serviceCount: Object.keys(services).length,
      });
    });

    // Gateway info
    this.app.get("/", (req, res) => {
      res.json({
        service: "API Gateway",
        version: "2.0.0",
        description: "Gateway para microsserviços com NoSQL (User, List, Item)",
        architecture: "Microservices with NoSQL databases",
        endpoints: {
          auth: "/api/auth/*",
          users: "/api/users/*",
          lists: "/api/lists/*",
          items: "/api/items/*",
          dashboard: "/api/dashboard",
          search: "/api/search",
        },
        services: serviceRegistry.listServices(),
      });
    });

    // Service registry endpoint
    this.app.get("/registry", (req, res) => {
      const services = serviceRegistry.listServices();
      res.json({
        success: true,
        services: services,
        count: Object.keys(services).length,
        timestamp: new Date().toISOString(),
      });
    });

    // Debug endpoint
    this.app.get("/debug/services", (req, res) => {
      serviceRegistry.debugListServices();
      res.json({
        success: true,
        services: serviceRegistry.listServices(),
        stats: serviceRegistry.getStats(),
      });
    });

    // Auth Routes -> User Service
    this.app.use("/api/auth", (req, res, next) => {
      this.proxyRequest("user-service", req, res, next);
    });

    // User Service Routes
    this.app.use("/api/users", (req, res, next) => {
      this.proxyRequest("user-service", req, res, next);
    });

    // Item Service Routes
    this.app.use("/api/items", (req, res, next) => {
      this.proxyRequest("item-service", req, res, next);
    });

    // List Service Routes
    this.app.use("/api/lists", (req, res, next) => {
      this.proxyRequest("list-service", req, res, next);
    });

    // Endpoints agregados
    this.app.get("/api/dashboard", this.getDashboard.bind(this));
    this.app.get("/api/search", this.globalSearch.bind(this));
  }

  setupErrorHandling() {
    this.app.use("*", (req, res) => {
      res.status(404).json({
        success: false,
        message: "Endpoint não encontrado",
        service: "api-gateway",
        availableEndpoints: [
          "/api/auth",
          "/api/users",
          "/api/lists",
          "/api/items",
        ],
      });
    });

    this.app.use((error, req, res, next) => {
      console.error("Gateway Error:", error);
      res.status(500).json({
        success: false,
        message: "Erro interno do gateway",
        error: error.message,
      });
    });
  }

  // Proxy request to service
  async proxyRequest(serviceName, req, res, next) {
    try {
      console.log(
        `Proxy request: ${req.method} ${req.originalUrl} -> ${serviceName}`
      );

      if (this.isCircuitOpen(serviceName)) {
        return res.status(503).json({
          success: false,
          message: `Serviço ${serviceName} temporariamente indisponível (Circuit Breaker)`,
          service: serviceName,
        });
      }

      let service;
      try {
        service = serviceRegistry.discover(serviceName);
      } catch (error) {
        console.error(
          `Erro na descoberta do serviço ${serviceName}:`,
          error.message
        );
        return res.status(503).json({
          success: false,
          message: `Serviço ${serviceName} não encontrado ou offline`,
          service: serviceName,
        });
      }

      // Lógica de Reescrita de Caminho (Path Rewriting)
      let targetPath = req.originalUrl;

      if (serviceName === "user-service") {
        // /api/users -> /users, /api/auth -> /auth
        targetPath = targetPath
          .replace("/api/users", "/users")
          .replace("/api/auth", "/auth");
      } else if (serviceName === "item-service") {
        // /api/items -> /items
        targetPath = targetPath.replace("/api/items", "/items");
      } else if (serviceName === "list-service") {
        // /api/lists -> /lists
        targetPath = targetPath.replace("/api/lists", "/lists");
      }

      // Garantir que path comece com / e não fique vazio
      if (!targetPath.startsWith("/")) targetPath = "/" + targetPath;
      if (targetPath === "/") {
        // Fallback para rota base do recurso se o path ficar vazio (ex: /api/items -> /items)
        if (serviceName === "item-service") targetPath = "/items";
        if (serviceName === "list-service") targetPath = "/lists";
        if (serviceName === "user-service" && req.originalUrl.includes("users"))
          targetPath = "/users";
      }

      const targetUrl = `${service.url}${targetPath}`;
      console.log(`Target URL: ${targetUrl}`);

      const config = {
        method: req.method,
        url: targetUrl,
        headers: { ...req.headers },
        timeout: 5000,
        family: 4,
        validateStatus: (status) => status < 500,
      };

      if (["POST", "PUT", "PATCH"].includes(req.method)) {
        config.data = req.body;
      }
      if (Object.keys(req.query).length > 0) {
        config.params = req.query;
      }

      // Limpar headers de host
      delete config.headers.host;
      delete config.headers["content-length"];

      const response = await axios(config);
      this.resetCircuitBreaker(serviceName);

      res.status(response.status).json(response.data);
    } catch (error) {
      this.recordFailure(serviceName);
      console.error(`Proxy error for ${serviceName}:`, error.message);

      if (error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT") {
        res.status(503).json({
          success: false,
          message: `Serviço ${serviceName} indisponível`,
          error: error.code,
        });
      } else if (error.response) {
        res.status(error.response.status).json(error.response.data);
      } else {
        res.status(500).json({
          success: false,
          message: "Erro interno do gateway",
          error: error.message,
        });
      }
    }
  }

  // Circuit Breaker Logic
  isCircuitOpen(serviceName) {
    const breaker = this.circuitBreakers.get(serviceName);
    if (!breaker) return false;

    const now = Date.now();
    if (breaker.isOpen && now - breaker.lastFailure > 30000) {
      breaker.isOpen = false;
      breaker.isHalfOpen = true;
      console.log(`Circuit breaker half-open for ${serviceName}`);
      return false;
    }
    return breaker.isOpen;
  }

  recordFailure(serviceName) {
    let breaker = this.circuitBreakers.get(serviceName) || {
      failures: 0,
      isOpen: false,
      isHalfOpen: false,
      lastFailure: null,
    };
    breaker.failures++;
    breaker.lastFailure = Date.now();

    if (breaker.failures >= 3) {
      breaker.isOpen = true;
      breaker.isHalfOpen = false;
      console.log(`Circuit breaker opened for ${serviceName}`);
    }
    this.circuitBreakers.set(serviceName, breaker);
  }

  resetCircuitBreaker(serviceName) {
    const breaker = this.circuitBreakers.get(serviceName);
    if (breaker) {
      breaker.failures = 0;
      breaker.isOpen = false;
      breaker.isHalfOpen = false;
    }
  }

  // Dashboard Agregado
  async getDashboard(req, res) {
    try {
      const authHeader = req.header("Authorization");
      if (!authHeader) {
        return res
          .status(401)
          .json({ success: false, message: "Token obrigatório" });
      }

      // Buscar dados de 3 serviços em paralelo
      const [listsRes, itemsRes, categoriesRes] = await Promise.allSettled([
        this.callService("list-service", "/lists", "GET", authHeader),
        this.callService("item-service", "/items", "GET", null, { limit: 5 }),
        this.callService("item-service", "/categories", "GET", null),
      ]);

      const dashboard = {
        timestamp: new Date().toISOString(),
        architecture: "Microservices with NoSQL",
        services_status: serviceRegistry.listServices(),
        data: {
          my_lists: {
            available: listsRes.status === "fulfilled",
            count:
              listsRes.status === "fulfilled" ? listsRes.value.data.length : 0,
            data:
              listsRes.status === "fulfilled"
                ? listsRes.value.data.slice(0, 3)
                : null,
          },
          recent_items: {
            available: itemsRes.status === "fulfilled",
            data: itemsRes.status === "fulfilled" ? itemsRes.value.data : null,
          },
          categories: {
            available: categoriesRes.status === "fulfilled",
            data:
              categoriesRes.status === "fulfilled"
                ? categoriesRes.value.data
                : null,
          },
        },
      };

      res.json({ success: true, data: dashboard });
    } catch (error) {
      console.error("Erro no dashboard:", error);
      res
        .status(500)
        .json({ success: false, message: "Erro ao gerar dashboard" });
    }
  }

  // Busca Global (Listas + Itens)
  async globalSearch(req, res) {
    try {
      const { q } = req.query;
      const authHeader = req.header("Authorization");

      if (!q) return res.status(400).json({ message: 'Query "q" obrigatória' });

      const promises = [
        this.callService("item-service", "/search", "GET", null, { q }),
      ];

      if (authHeader) {
        promises.push(
          this.callService("list-service", "/lists", "GET", authHeader)
        );
      }

      const [itemResults, listResults] = await Promise.allSettled(promises);

      const responseData = {
        query: q,
        items:
          itemResults.status === "fulfilled"
            ? itemResults.value.data.results
            : [],
        lists: [],
      };

      if (listResults && listResults.status === "fulfilled") {
        responseData.lists = listResults.value.data.filter((list) =>
          list.name.toLowerCase().includes(q.toLowerCase())
        );
      }

      res.json({ success: true, data: responseData });
    } catch (error) {
      console.error("Erro na busca global:", error);
      res.status(500).json({ success: false, message: "Erro na busca global" });
    }
  }

  async callService(
    serviceName,
    path,
    method = "GET",
    authHeader = null,
    params = {}
  ) {
    const service = serviceRegistry.discover(serviceName);
    const config = {
      method,
      url: `${service.url}${path}`,
      timeout: 5000,
      params,
    };
    if (authHeader) config.headers = { Authorization: authHeader };
    const response = await axios(config);
    return response.data;
  }

  startHealthChecks() {
    setInterval(() => serviceRegistry.performHealthChecks(), 30000);
    setTimeout(() => serviceRegistry.performHealthChecks(), 5000);
  }

  start() {
    this.app.listen(this.port, () => {
      console.log("=====================================");
      console.log(`API Gateway iniciado na porta ${this.port}`);
      console.log(`URL: http://localhost:${this.port}`);
      console.log("=====================================");
    });
  }
}

if (require.main === module) {
  const gateway = new APIGateway();
  gateway.start();
  process.on("SIGTERM", () => process.exit(0));
  process.on("SIGINT", () => process.exit(0));
}

module.exports = APIGateway;
