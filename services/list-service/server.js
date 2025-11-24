const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const axios = require("axios");

const JsonDatabase = require("../../shared/JsonDatabase");
const serviceRegistry = require("../../shared/serviceRegistry");

class ListService {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3002;
    this.serviceName = "list-service";
    this.serviceUrl = `http://127.0.0.1:${this.port}`;

    this.setupDatabase();
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupDatabase() {
    // Cria/Carrega o banco de dados de listas
    this.listsDb = new JsonDatabase(path.join(__dirname, "database"), "lists");
  }

  setupMiddleware() {
    this.app.use(helmet());
    this.app.use(cors());
    this.app.use(morgan("dev"));
    this.app.use(express.json());
  }

  // Middleware de Autenticação (Comunica com User Service)
  async authMiddleware(req, res, next) {
    const authHeader = req.header("Authorization");
    if (!authHeader) return res.status(401).json({ message: "Token required" });

    try {
      const userService = serviceRegistry.discover("user-service");
      const response = await axios.post(`${userService.url}/auth/validate`, {
        token: authHeader.replace("Bearer ", ""),
      });
      if (response.data.success) {
        req.user = response.data.data.user;
        next();
      } else {
        res.status(401).json({ message: "Invalid Token" });
      }
    } catch (error) {
      console.error("Erro de Auth:", error.message);
      res.status(503).json({ message: "Auth service unavailable" });
    }
  }

  setupRoutes() {
    this.app.get("/health", (req, res) =>
      res.json({ status: "healthy", service: this.serviceName })
    );

    // Rotas Protegidas
    this.app.use("/lists", this.authMiddleware.bind(this));

    this.app.post("/lists", this.createList.bind(this));
    this.app.get("/lists", this.getLists.bind(this));
    this.app.get("/lists/:id", this.getList.bind(this));
    this.app.put("/lists/:id", this.updateList.bind(this));
    this.app.delete("/lists/:id", this.deleteList.bind(this));

    // Gerenciamento de Itens na Lista
    this.app.post("/lists/:id/items", this.addItemToList.bind(this));
    this.app.put("/lists/:id/items/:itemId", this.updateItemInList.bind(this));
    this.app.delete(
      "/lists/:id/items/:itemId",
      this.removeItemFromList.bind(this)
    );
    this.app.get("/lists/:id/summary", this.getListSummary.bind(this));
  }

  async createList(req, res) {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ message: "Name required" });

    const newList = await this.listsDb.create({
      userId: req.user.id,
      name,
      description: description || "",
      status: "active",
      items: [], // Array de itens da lista
      summary: { totalItems: 0, purchasedItems: 0, estimatedTotal: 0 },
      createdAt: new Date().toISOString(),
    });
    res.status(201).json({ success: true, data: newList });
  }

  async getLists(req, res) {
    // Filtra apenas as listas do usuário logado
    const lists = await this.listsDb.find({ userId: req.user.id });
    res.json({ success: true, data: lists });
  }

  async getList(req, res) {
    const list = await this.listsDb.findById(req.params.id);
    if (!list || list.userId !== req.user.id) {
      return res.status(404).json({ message: "List not found" });
    }
    res.json({ success: true, data: list });
  }

  async updateList(req, res) {
    const { id } = req.params;
    const list = await this.listsDb.findById(id);
    if (!list || list.userId !== req.user.id)
      return res.status(404).json({ message: "Not found" });

    const updated = await this.listsDb.update(id, {
      name: req.body.name || list.name,
      description: req.body.description || list.description,
      status: req.body.status || list.status,
    });
    res.json({ success: true, data: updated });
  }

  async deleteList(req, res) {
    const { id } = req.params;
    const list = await this.listsDb.findById(id);
    if (!list || list.userId !== req.user.id)
      return res.status(404).json({ message: "Not found" });

    await this.listsDb.delete(id);
    res.json({ success: true, message: "Deleted" });
  }

  // Adicionar Item: Busca dados no Item Service para enriquecer a lista
  async addItemToList(req, res) {
    const { id } = req.params;
    const { itemId, quantity, notes } = req.body;

    const list = await this.listsDb.findById(id);
    if (!list || list.userId !== req.user.id)
      return res.status(404).json({ message: "List not found" });

    try {
      // 1. Descobrir onde está o Item Service
      const itemService = serviceRegistry.discover("item-service");

      // 2. Buscar detalhes do produto (preço, nome, unidade)
      const itemRes = await axios.get(`${itemService.url}/items/${itemId}`);
      const itemData = itemRes.data.data;

      if (!itemData)
        return res.status(404).json({ message: "Item product not found" });

      // 3. Adicionar à lista
      const newItem = {
        itemId: itemData.id,
        itemName: itemData.name, // Cache do nome
        quantity: parseInt(quantity) || 1,
        unit: itemData.unit,
        estimatedPrice: itemData.averagePrice,
        purchased: false,
        notes: notes || "",
        addedAt: new Date().toISOString(),
      };

      list.items.push(newItem);
      this.recalculateSummary(list);

      const updatedList = await this.listsDb.update(id, {
        items: list.items,
        summary: list.summary,
      });
      res.json({ success: true, data: updatedList });
    } catch (error) {
      console.error("Erro ao adicionar item:", error.message);
      res
        .status(400)
        .json({
          message:
            "Error adding item. Check Item ID or Item Service availability.",
        });
    }
  }

  async updateItemInList(req, res) {
    const { id, itemId } = req.params;
    const { quantity, purchased, notes } = req.body;

    const list = await this.listsDb.findById(id);
    if (!list || list.userId !== req.user.id)
      return res.status(404).json({ message: "List not found" });

    const itemIndex = list.items.findIndex((i) => i.itemId === itemId);
    if (itemIndex === -1)
      return res.status(404).json({ message: "Item not in list" });

    // Atualiza campos se fornecidos
    if (quantity) list.items[itemIndex].quantity = parseInt(quantity);
    if (purchased !== undefined) list.items[itemIndex].purchased = purchased;
    if (notes) list.items[itemIndex].notes = notes;

    this.recalculateSummary(list);
    const updated = await this.listsDb.update(id, {
      items: list.items,
      summary: list.summary,
    });
    res.json({ success: true, data: updated });
  }

  async removeItemFromList(req, res) {
    const { id, itemId } = req.params;
    const list = await this.listsDb.findById(id);
    if (!list || list.userId !== req.user.id)
      return res.status(404).json({ message: "List not found" });

    list.items = list.items.filter((i) => i.itemId !== itemId);
    this.recalculateSummary(list);

    const updated = await this.listsDb.update(id, {
      items: list.items,
      summary: list.summary,
    });
    res.json({ success: true, data: updated });
  }

  async getListSummary(req, res) {
    const list = await this.listsDb.findById(req.params.id);
    if (!list || list.userId !== req.user.id)
      return res.status(404).json({ message: "Not found" });
    res.json({ success: true, data: list.summary });
  }

  recalculateSummary(list) {
    let totalItems = 0;
    let purchasedItems = 0;
    let estimatedTotal = 0;

    list.items.forEach((item) => {
      totalItems += item.quantity;
      if (item.purchased) purchasedItems += item.quantity;
      estimatedTotal += item.quantity * item.estimatedPrice;
    });

    list.summary = { totalItems, purchasedItems, estimatedTotal };
  }

  start() {
    this.app.listen(this.port, () => {
      console.log(`List Service running on port ${this.port}`);
      serviceRegistry.register(this.serviceName, {
        url: this.serviceUrl,
        version: "1.0.0",
        endpoints: ["/health", "/lists"],
      });
      // Heartbeat
      setInterval(
        () => serviceRegistry.updateHealth(this.serviceName, true),
        30000
      );
    });
  }
}

if (require.main === module) {
  new ListService().start();
  process.on("SIGINT", () => {
    serviceRegistry.unregister("list-service");
    process.exit(0);
  });
}
