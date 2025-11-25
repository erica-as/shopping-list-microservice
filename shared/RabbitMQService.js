const amqp = require("amqplib");
const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

class RabbitMQService {
  constructor() {
    this.connection = null;
    this.channel = null;
    this.exchange = "shopping_events";
  }

  async connect() {
    if (this.connection) return;

    // Pega a URL da variável de ambiente ou usa um fallback local
    const RABBITMQ_URL =
      process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672";

    try {
      // Mascara a senha para não vazar no log
      const safeUrl = RABBITMQ_URL.replace(/:([^:@]+)@/, ":***@");
      console.log("🐰 Conectando ao RabbitMQ em:", safeUrl);

      this.connection = await amqp.connect(RABBITMQ_URL);
      this.channel = await this.connection.createChannel();

      // Cria o Exchange do tipo Topic (Durable = não perde se o Rabbit reiniciar)
      await this.channel.assertExchange(this.exchange, "topic", {
        durable: true,
      });
      console.log("✅ RabbitMQ conectado e Exchange configurado!");
    } catch (error) {
      console.error("❌ Erro ao conectar no RabbitMQ:", error.message);
      // Tenta reconectar em 5 segundos se falhar
      setTimeout(() => this.connect(), 5000);
    }
  }

  async publish(routingKey, message) {
    if (!this.channel) {
      // Se tentar publicar sem conexão, tenta conectar antes
      await this.connect();
    }

    if (this.channel && this.connection) {
      try {
        const buffer = Buffer.from(JSON.stringify(message));
        const published = this.channel.publish(
          this.exchange,
          routingKey,
          buffer
        );

        if (published) {
          console.log(`📤 Evento publicado: [${routingKey}]`);
        } else {
          console.error("⚠️ Falha ao publicar mensagem (Buffer cheio?)");
        }
        return published;
      } catch (err) {
        console.error("Erro ao publicar mensagem:", err.message);
        return false;
      }
    } else {
      console.error("❌ Impossível publicar: Canal fechado.");
      return false;
    }
  }
}

module.exports = new RabbitMQService();
