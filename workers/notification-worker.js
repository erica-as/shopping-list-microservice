const amqp = require("amqplib");
const path = require("path");

const QUEUE_NAME = "q_notifications";
const EXCHANGE_NAME = "shopping_events";
const ROUTING_KEY = "list.checkout.#";

require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

async function start() {
  try {
    console.log("📧 Notification Service iniciando...");

    // Pega URL da CloudAMQP ou local
    const RABBITMQ_URL =
      process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672";
    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();

    // 1. Garante Exchange
    await channel.assertExchange(EXCHANGE_NAME, "topic", { durable: true });

    // 2. Garante Fila Exclusiva
    await channel.assertQueue(QUEUE_NAME, { durable: true });

    // 3. Faz o Bind (Ligação)
    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, ROUTING_KEY);

    console.log(`📧 Conectado! Aguardando mensagens em [${QUEUE_NAME}]...`);

    channel.consume(QUEUE_NAME, (msg) => {
      if (msg !== null) {
        const content = JSON.parse(msg.content.toString());

        console.log("\n================================================");
        console.log("📨 [EMAIL SERVICE] Nova tarefa recebida!");
        console.log(`📄 Processando recibo da lista ID: ${content.listId}`);
        console.log(
          `👤 Enviando para: ${content.userEmail || "usuario@teste.com"}`
        );
        console.log("✅ Email enviado com sucesso!");
        console.log("================================================\n");

        channel.ack(msg);
      }
    });
  } catch (error) {
    console.error("Erro no Worker de Notificação:", error.message);
    setTimeout(start, 5000);
  }
}

start();
