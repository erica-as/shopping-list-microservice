const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const axios = require("axios");

// Importar banco NoSQL e service registry
const JsonDatabase = require("../../shared/JsonDatabase");
const serviceRegistry = require("../../shared/serviceRegistry");

class ItemService {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3003;
    this.serviceName = "item-service";
    this.serviceUrl = `http://127.0.0.1:${this.port}`;

    this.setupDatabase();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
    this.seedInitialData();
  }

  setupDatabase() {
    const dbPath = path.join(__dirname, "database");
    this.itemsDb = new JsonDatabase(dbPath, "items");
    console.log("Item Service: Banco NoSQL inicializado");
  }

  async seedInitialData() {
    // Aguardar inicialização e criar itens de exemplo
    setTimeout(async () => {
      try {
        const count = await this.itemsDb.count();

        if (count === 0) {
          const categories = [
            "Alimentos",
            "Limpeza",
            "Higiene",
            "Bebidas",
            "Padaria",
          ];
          const items = [];

          categories.forEach((cat, idx) => {
            for (let i = 1; i <= 4; i++) {
              items.push({
                id: uuidv4(),
                name: `Produto ${cat} ${i}`,
                category: cat,
                brand: `Marca ${String.fromCharCode(65 + idx)}`,
                unit: i % 2 === 0 ? "un" : "kg",
                averagePrice: parseFloat((Math.random() * 20 + 1).toFixed(2)),
                barcode: Math.floor(Math.random() * 10000000000).toString(),
                description: `Descrição do item de ${cat} número ${i}`,
                active: true,
                createdAt: new Date().toISOString(),
              });
            }
          });

          for (const item of items) {
            await this.itemsDb.create(item);
          }

          console.log("✅ 20 Itens de exemplo criados no Item Service");
        }
      } catch (error) {
        console.error("Erro ao criar dados iniciais:", error);
      }
    }, 1000);
  }

  setupMiddleware() {
    this.app.use(helmet());
    this.app.use(cors());
    this.app.use(morgan("combined"));
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    this.app.use((req, res, next) => {
      res.setHeader("X-Service", this.serviceName);
      res.setHeader("X-Service-Version", "1.0.0");
      res.setHeader("X-Database", "JSON-NoSQL");
      next();
    });
  }

  setupRoutes() {
    this.app.get("/health", async (req, res) => {
      try {
        const itemCount = await this.itemsDb.count();
        const activeItems = await this.itemsDb.count({ active: true });

        res.json({
          service: this.serviceName,
          status: "healthy",
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          version: "1.0.0",
          database: {
            type: "JSON-NoSQL",
            itemCount: itemCount,
            activeItems: activeItems,
          },
        });
      } catch (error) {
        res.status(503).json({
          service: this.serviceName,
          status: "unhealthy",
          error: error.message,
        });
      }
    });

    this.app.get("/", (req, res) => {
      res.json({
        service: "Item Service",
        endpoints: ["GET /items", "GET /items/:id", "GET /categories"],
      });
    });

    this.app.get("/items", this.getItems.bind(this));
    this.app.get("/items/:id", this.getItem.bind(this));
    this.app.post(
      "/items",
      this.authMiddleware.bind(this),
      this.createItem.bind(this)
    );
    this.app.put(
      "/items/:id",
      this.authMiddleware.bind(this),
      this.updateItem.bind(this)
    );
    this.app.delete(
      "/items/:id",
      this.authMiddleware.bind(this),
      this.deleteItem.bind(this)
    );
    this.app.get("/categories", this.getCategories.bind(this));
    this.app.get("/search", this.searchItems.bind(this));
  }

  setupErrorHandling() {
    this.app.use("*", (req, res) => {
      res
        .status(404)
        .json({ success: false, message: "Endpoint não encontrado" });
    });

    this.app.use((error, req, res, next) => {
      console.error("Item Service Error:", error);
      res
        .status(500)
        .json({ success: false, message: "Erro interno do serviço" });
    });
  }

  async authMiddleware(req, res, next) {
    const authHeader = req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ success: false, message: "Token obrigatório" });
    }

    try {
      const userService = serviceRegistry.discover("user-service");
      const response = await axios.post(
        `${userService.url}/auth/validate`,
        { token: authHeader.replace("Bearer ", "") },
        { timeout: 5000 }
      );

      if (response.data.success) {
        req.user = response.data.data.user;
        next();
      } else {
        res.status(401).json({ success: false, message: "Token inválido" });
      }
    } catch (error) {
      res.status(503).json({
        success: false,
        message: "Serviço de autenticação indisponível",
      });
    }
  }

  async getItems(req, res) {
    try {
      const { page = 1, limit = 10, category, name, active = true } = req.query;
      const skip = (page - 1) * parseInt(limit);

      const filter = { active: String(active) === "true" };

      if (category) {
        filter.category = category;
      }

      let items = await this.itemsDb.find(filter, {
        skip: skip,
        limit: parseInt(limit),
        sort: { createdAt: -1 },
      });

      if (name) {
        items = items.filter((i) =>
          i.name.toLowerCase().includes(name.toLowerCase())
        );
      }

      const total = await this.itemsDb.count(filter);

      res.json({
        success: true,
        data: items,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (error) {
      console.error("Erro ao buscar itens:", error);
      res.status(500).json({ success: false, message: "Erro interno" });
    }
  }

  async getItem(req, res) {
    try {
      const item = await this.itemsDb.findById(req.params.id);
      if (!item)
        return res
          .status(404)
          .json({ success: false, message: "Item não encontrado" });
      res.json({ success: true, data: item });
    } catch (error) {
      res.status(500).json({ success: false, message: "Erro interno" });
    }
  }

  async createItem(req, res) {
    try {
      const {
        name,
        category,
        brand,
        unit,
        averagePrice,
        barcode,
        description,
      } = req.body;
      if (!name || !category) {
        return res
          .status(400)
          .json({ success: false, message: "Dados incompletos" });
      }

      const newItem = await this.itemsDb.create({
        id: uuidv4(),
        name,
        category,
        brand: brand || "",
        unit: unit || "un",
        averagePrice: parseFloat(averagePrice) || 0,
        barcode: barcode || "",
        description: description || "",
        active: true,
        metadata: { createdBy: req.user.id },
      });

      res.status(201).json({ success: true, data: newItem });
    } catch (error) {
      res.status(500).json({ success: false, message: "Erro interno" });
    }
  }

  async updateItem(req, res) {
    try {
      const { id } = req.params;
      const item = await this.itemsDb.findById(id);
      if (!item)
        return res.status(404).json({ message: "Item não encontrado" });

      const updates = { ...req.body };
      delete updates.id;
      updates.updatedBy = req.user.id;

      const updatedItem = await this.itemsDb.update(id, updates);
      res.json({ success: true, data: updatedItem });
    } catch (error) {
      res.status(500).json({ success: false, message: "Erro interno" });
    }
  }

  async deleteItem(req, res) {
    try {
      const updated = await this.itemsDb.update(req.params.id, {
        active: false,
        deletedBy: req.user.id,
        deletedAt: new Date().toISOString(),
      });
      if (!updated)
        return res.status(404).json({ message: "Item não encontrado" });
      res.json({ success: true, message: "Item removido" });
    } catch (error) {
      res.status(500).json({ success: false, message: "Erro interno" });
    }
  }

  async getCategories(req, res) {
    try {
      const items = await this.itemsDb.find({ active: true });
      const categories = [...new Set(items.map((i) => i.category))].sort();
      res.json({ success: true, data: categories });
    } catch (error) {
      res.status(500).json({ success: false, message: "Erro interno" });
    }
  }

  async searchItems(req, res) {
    try {
      const { q, limit = 20 } = req.query;
      if (!q)
        return res
          .status(400)
          .json({ success: false, message: 'Query "q" obrigatória' });

      let items = await this.itemsDb.search(q, [
        "name",
        "brand",
        "description",
        "category",
      ]);
      items = items.filter((i) => i.active).slice(0, parseInt(limit));

      res.json({
        success: true,
        data: { query: q, results: items, total: items.length },
      });
    } catch (error) {
      res.status(500).json({ success: false, message: "Erro interno" });
    }
  }

  registerWithRegistry() {
    serviceRegistry.register(this.serviceName, {
      url: this.serviceUrl,
      version: "1.0.0",
      database: "JSON-NoSQL",
      endpoints: ["/health", "/items", "/categories", "/search"],
    });
  }

  startHealthReporting() {
    setInterval(() => {
      serviceRegistry.updateHealth(this.serviceName, true);
    }, 30000);
  }

  start() {
    this.app.listen(this.port, () => {
      console.log("=====================================");
      console.log(`Item Service iniciado na porta ${this.port}`);
      console.log(`URL: ${this.serviceUrl}`);
      console.log(`Health: ${this.serviceUrl}/health`);
      console.log("=====================================");
      this.registerWithRegistry();
      this.startHealthReporting();
    });
  }
}

if (require.main === module) {
  const itemService = new ItemService();
  itemService.start();

  const cleanup = () => {
    serviceRegistry.unregister("item-service");
    process.exit(0);
  };
  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
}

module.exports = ItemService;
