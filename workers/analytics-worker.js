const amqp = require("amqplib");

const QUEUE_NAME = "q_analytics";
const EXCHANGE_NAME = "shopping_events";
const ROUTING_KEY = "list.checkout.completed"; // Apenas completados

async function start() {
  try {
    console.log("📊 Analytics Service iniciando...");

    const RABBITMQ_URL =
      process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672";
    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();

    await channel.assertExchange(EXCHANGE_NAME, "topic", { durable: true });
    await channel.assertQueue(QUEUE_NAME, { durable: true });
    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, ROUTING_KEY);

    console.log(`📊 Conectado! Aguardando mensagens em [${QUEUE_NAME}]...`);

    channel.consume(QUEUE_NAME, (msg) => {
      if (msg !== null) {
        const content = JSON.parse(msg.content.toString());

        console.log("\n------------------------------------------------");
        console.log("📊 [ANALYTICS] Processando inteligência de vendas");

        const totalSpent = content.summary.estimatedTotal;
        const totalItems = content.summary.totalItems;

        console.log(`💰 Total da Transação: R$ ${totalSpent.toFixed(2)}`);
        console.log(`📦 Volume de Itens: ${totalItems}`);
        console.log("📈 Dados computados para o Dashboard BI");
        console.log("------------------------------------------------\n");

        channel.ack(msg);
      }
    });
  } catch (error) {
    console.error("Erro no Worker de Analytics:", error.message);
    setTimeout(start, 5000);
  }
}

start();
